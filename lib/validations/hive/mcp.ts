import { workEmailSchema } from "./escalation";

/**
 * The employee identity Siraaj may forward on an MCP request (blueprint
 * `hive-siraaj-mcp.md` OQ-S1), as `X-Siraaj-User-Email`.
 *
 * The same work-email rule a ticket's own address must pass: a forwarded value
 * that is not a Rihal mailbox is ignored, never trusted.
 *
 * @public
 */
export const mcpIdentitySchema = workEmailSchema;
