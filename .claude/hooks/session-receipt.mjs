#!/usr/bin/env node
// SessionEnd hook -- session cost receipt (ADR-019).
// Appends one JSONL row per session to .claude/usage-log.jsonl (gitignored) so
// spend drift is visible the day it happens. Pure local accounting; no network.
import { readFileSync, appendFileSync, writeFileSync, existsSync } from "node:fs";

const MAX_ROWS = 500; // keep the log bounded -- it's local accounting, not history.

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
  const logUrl = new URL("../usage-log.jsonl", import.meta.url);
  appendFileSync(logUrl, JSON.stringify(row) + "\n");
  // Rotate: keep only the most recent MAX_ROWS so the log can't grow unbounded.
  try {
    const all = readFileSync(logUrl, "utf8").trim().split("\n");
    if (all.length > MAX_ROWS) writeFileSync(logUrl, all.slice(-MAX_ROWS).join("\n") + "\n");
  } catch { /* rotation is best-effort */ }
} catch { /* never fail session end */ }
process.exit(0);
