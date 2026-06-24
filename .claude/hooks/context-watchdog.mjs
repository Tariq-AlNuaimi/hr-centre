#!/usr/bin/env node
// UserPromptSubmit hook -- context watchdog (ADR-019).
// Reads the session transcript, estimates the live context size from the last
// assistant message's usage block, and warns ONCE per threshold so the operator
// (and Claude) know when to /handoff-session + /clear instead of degrading.
import { readFileSync, existsSync, writeFileSync } from "node:fs";

// Effective window. Override via CLAUDE_CTX_LIMIT for [1m] models so the warnings
// fire at the right fraction instead of harmlessly late.
const LIMIT = Number(process.env.CLAUDE_CTX_LIMIT) || 200_000;
const THRESHOLDS = [
  [0.9, "context ~{pct}% -- STOP: /handoff-session THIS turn before quality drops; you are near the hard limit"],
  [0.8, "context ~{pct}% -- run /handoff-session NOW and continue in a fresh session (quality + cost degrade from here)"],
  [0.6, "context ~{pct}% -- plan to /handoff-session at the next natural milestone (green ship / landed commit)"],
];

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const t = input.transcript_path;
  if (!t || !existsSync(t)) process.exit(0);
  const lines = readFileSync(t, "utf8").trim().split("\n");
  let usage = null;
  for (let i = lines.length - 1; i >= 0 && !usage; i--) {
    try {
      const e = JSON.parse(lines[i]);
      if (e.type === "assistant" && e.message?.usage) usage = e.message.usage;
    } catch { /* skip malformed line */ }
  }
  if (!usage) process.exit(0);
  const ctx =
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.output_tokens ?? 0);
  const frac = ctx / LIMIT;
  const stateFile = `/tmp/ctx-watchdog-${input.session_id ?? "s"}`;
  const fired = existsSync(stateFile) ? readFileSync(stateFile, "utf8") : "";
  for (const [th, msg] of THRESHOLDS) {
    if (frac >= th && !fired.includes(`${th}`)) {
      writeFileSync(stateFile, `${fired} ${th}`);
      console.log(`[token-watchdog] ${msg.replace("{pct}", Math.round(frac * 100))}`);
      break;
    }
  }
} catch { /* never block the prompt */ }
process.exit(0);
