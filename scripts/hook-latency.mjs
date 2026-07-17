#!/usr/bin/env node
// Hook-chain latency check (harness-v2 V2-103, velocity pillar check c).
//
// Times the `UserPromptSubmit` + `PreToolUse` hook chain wired in `.claude/settings.json` — the
// per-turn tax the operator pays before any real work — and warns when it regresses past 150% of
// the recorded warm baseline (`project.config.json` `velocityBaselines.hookChainMs`). Advisory
// (fail-open, house pattern): exit 0 by default. `--strict` exits 1 past threshold (hook test);
// `--record` writes the freshly-measured value back as the baseline.
//
// Usage: node scripts/hook-latency.mjs [--strict] [--record]  (npm run hook-latency).
// Baseline override for tests: env HOOK_CHAIN_BASELINE_MS.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const THRESHOLD = 1.5; // warn past 150% of baseline
const strict = process.argv.includes("--strict");
const record = process.argv.includes("--record");

function readJson(p) {
  try {
    return JSON.parse(readFileSync(join(ROOT, p), "utf8"));
  } catch {
    return null;
  }
}

const settings = readJson(".claude/settings.json");
if (!settings?.hooks) {
  console.error("[hook-latency] no .claude/settings.json hooks -- skipped");
  process.exit(0);
}

// Collect the per-turn chain: UserPromptSubmit (prompt-shaped input) + PreToolUse (tool-shaped).
// Each entry = { cmd, stdin }. We time the real hook processes on synthetic input.
const chain = [];
const promptInput = JSON.stringify({ prompt: "scaffold a new entity and deploy it" });
const toolInput = JSON.stringify({
  tool_name: "Edit",
  tool_input: { file_path: "lib/api-helpers.ts" },
});
for (const grp of settings.hooks.UserPromptSubmit || [])
  for (const h of grp.hooks || [])
    if (h.command) chain.push({ cmd: h.command, stdin: promptInput });
for (const grp of settings.hooks.PreToolUse || [])
  for (const h of grp.hooks || []) if (h.command) chain.push({ cmd: h.command, stdin: toolInput });

if (chain.length === 0) {
  console.error("[hook-latency] no UserPromptSubmit/PreToolUse command hooks found -- skipped");
  process.exit(0);
}

// Resolve $CLAUDE_PROJECT_DIR and run each hook, summing wall time. (Node's own start-up cost is
// part of the real tax — we measure the process as the harness invokes it.)
let totalMs = 0;
const perHook = [];
for (const { cmd, stdin } of chain) {
  const resolved = cmd.replace(/\$CLAUDE_PROJECT_DIR/g, ROOT).replace(/^node\s+/, "");
  const t0 = process.hrtime.bigint();
  spawnSync("node", [resolved], { input: stdin, cwd: ROOT, encoding: "utf8" });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  totalMs += ms;
  perHook.push(`${resolved.split("/").pop()}:${ms.toFixed(0)}ms`);
}
totalMs = Math.round(totalMs);

const cfg = readJson("project.config.json") || {};
const baseline =
  Number(process.env.HOOK_CHAIN_BASELINE_MS) || cfg.velocityBaselines?.hookChainMs || 0;

console.log(
  `[hook-latency] chain ${totalMs}ms over ${chain.length} hooks · ${perHook.join(" · ")}`,
);

if (record) {
  if (!existsSync(join(ROOT, "project.config.json"))) {
    console.error("[hook-latency] no project.config.json to record into");
  } else {
    cfg.velocityBaselines = { ...(cfg.velocityBaselines || {}), hookChainMs: totalMs };
    writeFileSync(join(ROOT, "project.config.json"), JSON.stringify(cfg, null, 2) + "\n");
    console.log(`[hook-latency] recorded baseline hookChainMs=${totalMs}`);
  }
  process.exit(0);
}

if (!baseline) {
  console.log(
    "[hook-latency] no baseline recorded (set velocityBaselines.hookChainMs, or --record).",
  );
  process.exit(0);
}
const limit = Math.round(baseline * THRESHOLD);
if (totalMs > limit) {
  console.log(
    `[hook-latency] WARN: chain ${totalMs}ms > ${Math.round(THRESHOLD * 100)}% of the ${baseline}ms baseline (${limit}ms). A hook slowed down -- profile the chain.`,
  );
  if (strict) process.exit(1);
} else {
  console.log(`[hook-latency] OK (baseline ${baseline}ms, limit ${limit}ms).`);
}
process.exit(0);
