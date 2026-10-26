import "@/lib/hive/tools/register";
import { runTool, toolDefinitions } from "@/lib/hive/tools";
import type { McpServer, McpTool } from "./protocol";

/**
 * HIVE's tools, as Siraaj sees them (ADR-075).
 *
 * Every MCP tool is a thin name over a HIVE tool that already exists in
 * `lib/hive/tools/*` — routing, rotation, discounts, providers, org chart and
 * ticket opening each have ONE implementation, which is the point of serving
 * them rather than re-describing them in Siraaj's prompt. Names are prefixed
 * `hive_` so they read unambiguously beside other servers' tools in Siraaj.
 *
 * @public
 */

const NAMES: Record<string, string> = {
  hive_open_ticket: "escalate",
  hive_find_hr_tag: "hr_tag",
  hive_office_rotation: "office_rotation",
  hive_employee_discounts: "employee_discounts",
  hive_network_providers: "network_providers",
  hive_org_structure: "organization_structure",
};

/** The HIVE tool names this server must find registered. @public */
export const MCP_TOOL_NAMES = Object.keys(NAMES);

const INSTRUCTIONS =
  "HIVE is Rihal HR's ticket desk and the source of HR's structured data. Use " +
  "hive_find_hr_tag, hive_office_rotation, hive_employee_discounts, " +
  "hive_network_providers and hive_org_structure for those questions instead of " +
  "guessing. When the employee needs a person from HR, offer hive_open_ticket: ask " +
  "for their full name and Rihal work email together, confirm the question in their " +
  "own words, then call it and tell them the ticket ID and which HR Tag pair has it. " +
  "HR reviews every answer before it is emailed. Never promise or estimate when " +
  "they will hear back.";

/**
 * The server, for one request. `verifiedEmail` is the signed-in employee when
 * Siraaj forwards it (blueprint OQ-S1): it then overrides whatever email the
 * model put in the arguments, so nobody can open a ticket in a colleague's name.
 */
export function hiveMcpServer(verifiedEmail: string | null): McpServer {
  return {
    name: "hive",
    version: "1.0.0",
    instructions: INSTRUCTIONS,
    listTools(): McpTool[] {
      const byName = new Map(toolDefinitions().map((d) => [d.function.name, d.function]));
      return Object.entries(NAMES).flatMap(([mcpName, hiveName]) => {
        const def = byName.get(hiveName);
        return def
          ? [{ name: mcpName, description: def.description, inputSchema: def.parameters }]
          : [];
      });
    },
    async callTool(name, args) {
      // Own properties only: `NAMES["constructor"]` must not resolve.
      if (!Object.hasOwn(NAMES, name)) return null;
      const hiveName = NAMES[name]!;
      const finalArgs =
        hiveName === "escalate" && verifiedEmail ? { ...args, employeeEmail: verifiedEmail } : args;
      const result = await runTool(hiveName, JSON.stringify(finalArgs), {
        companyId: null,
        orgUnitId: null,
        sessionId: null,
        source: "SIRAAJ",
        identityVerified: verifiedEmail !== null,
      });
      return { result, isError: "error" in result };
    },
  };
}
