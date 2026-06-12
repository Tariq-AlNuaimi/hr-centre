#!/usr/bin/env node
// SessionEnd hook -- session cost receipt (ADR-019).
// Appends one JSONL row per session to .claude/usage-log.jsonl (gitignored) so
// spend drift is visible the day it happens. Pure local accounting; no network.
import { readFileSync, appendFileSync, existsSync } from "node:fs";

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const t = input.transcript_path;
  if (!t || !existsSync(t)) process.exit(0);
  let msgs = 0, out = 0, lastCtx = 0;
  for (const line of readFileSync(t, "utf8").trim().split("\n")) {
    try {
      const e = JSON.parse(line);
      const u = e.message?.usage;
      if (e.type === "assistant" && u) {
        msgs++;
        out += u.output_tokens ?? 0;
        lastCtx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) +
                  (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
      }
    } catch { /* skip */ }
  }
  const row = {
    ts: new Date().toISOString(),
    session: input.session_id ?? "?",
    reason: input.reason ?? "?",
    assistant_msgs: msgs,
    output_tokens: out,
    final_context: lastCtx,
  };
  appendFileSync(new URL("../usage-log.jsonl", import.meta.url), JSON.stringify(row) + "\n");
} catch { /* never fail session end */ }
process.exit(0);
