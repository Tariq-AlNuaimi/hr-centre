/**
 * Importing this module registers every HIVE tool.
 *
 * A tool module has to be IMPORTED before its `registerTool` call runs, and
 * `tools/index.ts` cannot import them — they import it, so it would be a cycle.
 * One module whose only job is the import list breaks that, and makes "is this
 * tool live?" answerable by reading a single file rather than by tracing which
 * module happened to be loaded first.
 *
 * `lib/hive/mcp/tools.ts` imports this for its side effect. That is the one
 * place it needs to happen, because the MCP server is what advertises the
 * definitions to Siraaj — a tool registered but never advertised is the silent
 * no-tools mode this file exists to make impossible.
 */

import "./rotation";
import "./discounts";
import "./orgchart";
import "./hrtags";
import "./providers";
import "./escalate";
