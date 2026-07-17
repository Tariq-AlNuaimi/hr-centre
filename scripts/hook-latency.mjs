#!/usr/bin/env node
// Hook-chain latency check (harness-v2 V2-103, velocity pillar check c).
//
// Times the REAL per-turn hook chains wired in `.claude/settings.json` and warns when the worst
// turn regresses past 150% of the recorded warm baseline (`project.config.json`
// `velocityBaselines.hookChainMs`). A turn = the `UserPromptSubmit` hooks (prompt) PLUS the
// `PreToolUse` hooks whose matcher matches the tool being called. Those matcher groups are
// mutually exclusive per real call — an `Edit` fires only the Edit group, a `Bash` only the
// Bash/Read groups — so we measure each turn shape SEPARATELY (senior-review V2-103 High) with
// tool-shape-correct synthetic input, and baseline against the worst (slowest) turn.
//
// Advisory (fail-open, house pattern): exit 0 by default. `--strict` exits 1 past threshold OR when
// a hook fails to run (an unreliable measurement, senior-review V2-103 Medium). `--record` writes
// the measured worst-turn value back as the baseline. Baseline override for tests: HOOK_CHAIN_BASELINE_MS.
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

// Tool-shape-correct synthetic input per tool, so each hook exercises its REAL logic (not a
// wrong-tool early-exit). The Bash command is a plausibly-long one so the command-scanning hooks
// (dangerous-commands / bash-write-gate / protect-secrets) do real regex work.
const inputFor = {
  UserPromptSubmit: JSON.stringify({ prompt: "scaffold a new entity and deploy it" }),
  Edit: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "lib/api-helpers.ts" } }),
  Bash: JSON.stringify({
    tool_name: "Bash",
    tool_input: { command: "rm -rf .next && npm run build 2>&1 | tail && grep -r TODO app lib" },
  }),
};
const cmds = (grp) => (grp?.hooks || []).map((h) => h.command).filter(Boolean);
const upsHooks = (settings.hooks.UserPromptSubmit || []).flatMap(cmds);
const preGroups = settings.hooks.PreToolUse || [];
// A matcher "A|B|C" matches tool T when T is one of its alternatives.
const groupsForTool = (tool) =>
  preGroups
    .filter((g) =>
      String(g.matcher || "")
        .split("|")
        .includes(tool),
    )
    .flatMap(cmds);

const unreliable = [];
function timeHook(cmd, stdin) {
  const resolved = cmd.replace(/\$CLAUDE_PROJECT_DIR/g, ROOT).replace(/^node\s+/, "");
  const t0 = process.hrtime.bigint();
  const res = spawnSync("node", [resolved], { input: stdin, cwd: ROOT, encoding: "utf8" });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  // Hooks signal deny/allow via stdout JSON and exit 0; a non-zero exit or spawn error means the
  // hook didn't actually run its logic -> the measurement is not trustworthy. Flag loudly.
  if (res.error || res.status !== 0)
    unreliable.push(
      `${resolved.split("/").pop()} (${res.error ? res.error.code : "exit " + res.status})`,
    );
  return ms;
}

// Measure each real turn shape: UserPromptSubmit hooks + the matching PreToolUse group.
function measureTurn(tool) {
  let ms = 0;
  for (const c of upsHooks) ms += timeHook(c, inputFor.UserPromptSubmit);
  for (const c of groupsForTool(tool)) ms += timeHook(c, inputFor[tool] || inputFor.Edit);
  return Math.round(ms);
}
const turns = { "edit-turn": measureTurn("Edit"), "bash-turn": measureTurn("Bash") };
const worst = Math.max(...Object.values(turns));

console.log(
  `[hook-latency] worst turn ${worst}ms · ` +
    Object.entries(turns)
      .map(([k, v]) => `${k}:${v}ms`)
      .join(" · "),
);
if (unreliable.length)
  console.log(
    `[hook-latency] WARN: ${unreliable.length} hook(s) failed to run: ${unreliable.join(", ")}`,
  );

if (record) {
  if (!existsSync(join(ROOT, "project.config.json"))) {
    console.error("[hook-latency] no project.config.json to record into");
  } else {
    const cfg = readJson("project.config.json") || {};
    cfg.velocityBaselines = { ...(cfg.velocityBaselines || {}), hookChainMs: worst };
    writeFileSync(join(ROOT, "project.config.json"), JSON.stringify(cfg, null, 2) + "\n");
    console.log(`[hook-latency] recorded baseline hookChainMs=${worst} (worst turn)`);
  }
  process.exit(0);
}

const cfg = readJson("project.config.json") || {};
const baseline =
  Number(process.env.HOOK_CHAIN_BASELINE_MS) || cfg.velocityBaselines?.hookChainMs || 0;
if (!baseline) {
  console.log("[hook-latency] no baseline recorded (velocityBaselines.hookChainMs, or --record).");
  process.exit(strict && unreliable.length ? 1 : 0);
}
const limit = Math.round(baseline * THRESHOLD);
if (worst > limit) {
  console.log(
    `[hook-latency] WARN: worst turn ${worst}ms > ${Math.round(THRESHOLD * 100)}% of the ${baseline}ms baseline (${limit}ms). A hook slowed down -- profile the chain.`,
  );
} else {
  console.log(`[hook-latency] OK (baseline ${baseline}ms, limit ${limit}ms).`);
}
if (strict && (worst > limit || unreliable.length)) process.exit(1);
process.exit(0);
