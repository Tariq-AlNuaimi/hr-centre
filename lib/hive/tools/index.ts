/**
 * The tool registry (ADR-066).
 *
 * "Every fact that _changes with time or input_ — which week of the rotation it
 * is, whether a discount has expired, whether a clinic is in-network — is
 * answered by a **deterministic tool**, not by retrieval. A vector store would
 * give a plausible-sounding wrong rotation answer; a pure function cannot."
 *
 * Since ADR-075 the caller is Siraaj, over MCP (`lib/hive/mcp/`): HIVE no longer
 * runs its own model. Two properties hold for every tool registered here, and
 * they are what make it safe to hand to someone else's language model
 * ("prompt-injection is bounded by design"):
 *
 * 1. **Read-only, except `escalate`** — and `escalate` cannot send anything: it
 *    opens a row that a human must approve (§5.3, AC-11.1). There is no tool
 *    that mutates content, grants access, or reaches a `User` row.
 * 2. **No tool takes an identity.** Nothing accepts "whose balance", because
 *    §2.2 forbids HIVE confirming personal data and the robust way to guarantee
 *    that is to give it no way to ask.
 *
 * @public
 */

/** What a tool may know about the caller. Deliberately not an identity. */
export interface ToolContext {
  /** §3.5's company/directorate, if the employee has said. Ids, resolved by the
   *  tool against the database — never trusted from the model. */
  companyId: string | null;
  orgUnitId: string | null;
  /** A HIVE chat conversation to thread a ticket to. Always null since ADR-075
   *  retired the chat; kept nullable so historical tickets keep their link. */
  sessionId: string | null;
  /** Where the request came from, recorded on any ticket it opens. */
  source: "HIVE" | "SIRAAJ";
  /** True when the caller vouched for the employee's identity (Siraaj's
   *  forwarded sign-in), so the ticket email is not the model's say-so. */
  identityVerified: boolean;
}

/** A tool's answer. Always JSON-serialisable, never a thrown error. */
export type ToolResult = Record<string, unknown>;

/**
 * A tool's name, description and JSON-Schema arguments — the function-tool
 * shape both the OpenAI wire format and MCP's `tools/list` are built from, so
 * HIVE depends on neither SDK to describe its own tools.
 */
export interface HiveToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface HiveTool {
  definition: HiveToolDefinition;
  run: (args: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

/** Registered tools, by name. Phase 4 adds entries. */
const REGISTRY = new Map<string, HiveTool>();

export function registerTool(tool: HiveTool): void {
  const name = tool.definition.function.name;
  // Two tools answering to one name would be resolved by whichever registered
  // last — a silent behaviour change caused by an import order.
  if (REGISTRY.has(name)) throw new Error(`Duplicate HIVE tool: ${name}`);
  REGISTRY.set(name, tool);
}

/**
 * The definitions handed to the caller.
 *
 * DERIVED from the registry on every call, not a second array maintained beside
 * it. The first cut kept both and they immediately disagreed — `registerTool`
 * filled the map while the array stayed empty, so every tool was runnable and
 * none was advertised. That is the exact drift this file's own comment warned
 * about, and the only reliable fix is for there to be one list.
 */
export function toolDefinitions(): HiveToolDefinition[] {
  return [...REGISTRY.values()].map((t) => t.definition);
}

/**
 * Run one tool call.
 *
 * Never throws, and never returns nothing. A tool that fails returns a result
 * SAYING it failed, because the alternative — an empty tool response — leaves
 * the model to compose what the tool would have said, which is exactly the
 * plausible-sounding-wrong-answer failure ADR-066 chose tools to avoid.
 *
 * The arguments are whatever the model emitted, so they are parsed defensively
 * and validated by the tool itself: on an anonymous surface (ADR-068) a tool
 * argument is one indirection away from being attacker-influenced text.
 */
export async function runTool(
  name: string,
  rawArgs: string,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = REGISTRY.get(name);
  if (!tool) return { error: "unknown_tool", detail: `HIVE has no tool called ${name}.` };

  let args: unknown;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return { error: "bad_arguments", detail: "Those arguments were not valid JSON." };
  }

  try {
    return await tool.run(args, ctx);
  } catch {
    // The message is deliberately not surfaced: a tool error can carry a query,
    // a row, or a connection string, and this string goes into the model's
    // context and from there into an answer an employee reads.
    return { error: "tool_failed", detail: `The ${name} lookup did not work just now.` };
  }
}
