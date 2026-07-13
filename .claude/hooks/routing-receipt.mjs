#!/usr/bin/env node
// PostToolUse(Task) hook — routing-adherence receipt (ADR-054, observe-only v1).
// Appends one JSONL row per subagent spawn to .claude/state/routing-receipts.jsonl
// (gitignored, same precedent as usage-log.jsonl) so ADR-022's model-tier table
// becomes an OBSERVED fact instead of advisory prose. No enforcement, no
// permissionDecision, no output — summarize with `npm run routing-report`.
// Contract: a receipt appender must never brick a turn (always exit 0).
import { readFileSync, appendFileSync, writeFileSync, mkdirSync } from "node:fs";

const MAX_ROWS = 1000; // bounded local accounting, not history.

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if (input.tool_name !== "Task") process.exit(0);
  const ti = input.tool_input ?? {};
  const row = {
    ts: new Date().toISOString(),
    session: input.session_id ?? "?",
    agent: ti.subagent_type ?? "general-purpose",
    // Explicit per-spawn model override only; null = the agent definition's
    // `model:` frontmatter tier applied (routing-report resolves that side).
    model: ti.model ?? null,
    desc: String(ti.description ?? "").slice(0, 80),
  };
  const dir = new URL("../state/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  const log = new URL("routing-receipts.jsonl", dir);
  appendFileSync(log, JSON.stringify(row) + "\n");
  // Rotate: keep only the most recent MAX_ROWS.
  try {
    const all = readFileSync(log, "utf8").trim().split("\n");
    if (all.length > MAX_ROWS) writeFileSync(log, all.slice(-MAX_ROWS).join("\n") + "\n");
  } catch {
    /* rotation is best-effort */
  }
} catch {
  /* never fail the turn */
}
process.exit(0);
