import { z } from "zod";

/**
 * The slice of the Model Context Protocol HIVE speaks (ADR-074, ADR-075).
 *
 * Streamable HTTP, stateless: every request is one JSON-RPC 2.0 message in a
 * POST body and every answer is one JSON body — no session id, no server-sent
 * events, because nothing here ever needs to push to Siraaj. Five methods:
 * `initialize`, the `notifications/initialized` ack, `ping`, `tools/list`,
 * `tools/call`. Hand-written rather than the official SDK (ADR-074 as amended):
 * the SDK is a >50 KB runtime dependency (Ask-before) for what is a few dozen
 * lines of dispatch, and this keeps HIVE on Next's own Request/Response.
 *
 * @public
 */

/** Revisions this server accepts; the newest is offered when a client asks for another. */
const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

const requestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().min(1).max(100),
  params: z.record(z.string(), z.unknown()).optional(),
});

const callParamsSchema = z.object({
  name: z.string().min(1).max(100),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

/** JSON-RPC error codes used here. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServer {
  name: string;
  version: string;
  instructions: string;
  listTools: () => McpTool[];
  /** Runs one tool. Returns `null` for a name it does not have. */
  callTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{
    result: Record<string, unknown>;
    isError: boolean;
  } | null>;
}

type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

const fail = (id: string | number | null, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

/**
 * Handle one message. Returns `null` for a notification (no `id`), which the
 * transport answers with 202 and no body, as the spec requires.
 */
export async function handleMcpMessage(
  server: McpServer,
  raw: unknown,
): Promise<JsonRpcResponse | null> {
  // JSON-RPC batches were removed from MCP in 2025-06-18; refuse rather than
  // half-support them.
  if (Array.isArray(raw)) return fail(null, INVALID_REQUEST, "Batch requests are not supported.");
  // A JSON-RPC RESPONSE posted by the client (no method) is acknowledged like a
  // notification — this server never sends requests, so there is nothing to match.
  if (isClientResponse(raw)) return null;
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return fail(null, INVALID_REQUEST, "Not a JSON-RPC 2.0 request.");
  const { id, method, params } = parsed.data;
  if (id === undefined) return null; // notification, e.g. notifications/initialized

  switch (method) {
    case "initialize": {
      const asked = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (SUPPORTED_VERSIONS as readonly string[]).includes(asked)
        ? asked
        : SUPPORTED_VERSIONS[0];
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: server.name, version: server.version },
          instructions: server.instructions,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: server.listTools() } };
    case "tools/call": {
      const call = callParamsSchema.safeParse(params ?? {});
      if (!call.success) return fail(id, INVALID_PARAMS, "tools/call needs a tool name.");
      const outcome = await server.callTool(call.data.name, call.data.arguments ?? {});
      if (!outcome) return fail(id, INVALID_PARAMS, `Unknown tool: ${call.data.name}`);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          // Text for clients that read `content`, structured data for those that
          // read `structuredContent` — the same object either way.
          content: [{ type: "text", text: JSON.stringify(outcome.result) }],
          structuredContent: outcome.result,
          isError: outcome.isError,
        },
      };
    }
    default:
      return fail(id, METHOD_NOT_FOUND, `Method not supported: ${method}`);
  }
}

function isClientResponse(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return r.jsonrpc === "2.0" && !("method" in r) && ("result" in r || "error" in r);
}

/** For a body that was not JSON at all. */
export function parseErrorResponse(): JsonRpcResponse {
  return fail(null, PARSE_ERROR, "The request body was not valid JSON.");
}
