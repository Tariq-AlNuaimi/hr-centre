#!/usr/bin/env node
// scripts/routing-report.mjs — routing-adherence report (ADR-054, observe-only v1).
// Summarizes the subagent-spawn receipts appended by the PostToolUse(Task) hook
// (.claude/hooks/routing-receipt.mjs → .claude/state/routing-receipts.jsonl,
// gitignored) against the ADR-022 model-tier table (docs/token-policy.md):
//
//   cheap = haiku (scout: recon, repo-wide reads, codemods)
//   mid   = sonnet (default working model; senior-code-reviewer, sre)
//   top   = opus/fable (security-architect; architecture-grade sessions)
//
// /ship-independent and NEVER enforcing: it turns the advisory tier table into an
// observed fact (did recon actually ride the cheap tier? were top-tier spawns
// deliberate?), which doubles as a cost lens post the Agent-SDK credit split.
// Always exits 0. Promotion to a soft /ship gate waits for ADR-054's "token
// spend becomes a budget line" trigger.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LOG = ".claude/state/routing-receipts.jsonl";
const AGENTS_DIR = ".claude/agents";

const TIER_OF_MODEL = {
  haiku: "cheap",
  sonnet: "mid",
  opus: "top",
  fable: "top",
};

// --- expected tier per agent, from the agent definitions' `model:` frontmatter
function expectedModels() {
  const map = {};
  if (!existsSync(AGENTS_DIR)) return map;
  for (const f of readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"))) {
    const src = readFileSync(join(AGENTS_DIR, f), "utf8");
    const fm = /^---\n([\s\S]*?)\n---/.exec(src)?.[1] ?? "";
    const name = /^name:\s*(\S+)/m.exec(fm)?.[1] ?? f.replace(/\.md$/, "");
    const model = /^model:\s*(\S+)/m.exec(fm)?.[1] ?? null;
    map[name] = model;
  }
  return map;
}

if (!existsSync(LOG)) {
  console.log(
    `routing-report: no receipts yet (${LOG} missing). Receipts appear once subagents run with the PostToolUse(Task) hook bound; observe-only, exiting green.`,
  );
  process.exit(0);
}

const rows = readFileSync(LOG, "utf8")
  .trim()
  .split("\n")
  .flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });

if (rows.length === 0) {
  console.log("routing-report: receipts file is empty; nothing to summarize. Exiting green.");
  process.exit(0);
}

const expected = expectedModels();

// --- aggregate per agent ------------------------------------------------------
const byAgent = new Map();
for (const r of rows) {
  const key = r.agent ?? "?";
  const agg = byAgent.get(key) ?? { spawns: 0, overrides: new Map() };
  agg.spawns++;
  if (r.model) agg.overrides.set(r.model, (agg.overrides.get(r.model) ?? 0) + 1);
  byAgent.set(key, agg);
}

console.log(`routing-report: ${rows.length} subagent spawn(s) on record (${LOG})`);
console.log("");
console.log("agent                      spawns  expected-model(tier)   explicit overrides");
console.log("-------------------------  ------  ---------------------  ------------------");
const notes = [];
for (const [agent, agg] of [...byAgent.entries()].sort((a, b) => b[1].spawns - a[1].spawns)) {
  const exp = expected[agent] ?? null;
  const expLabel = exp ? `${exp} (${TIER_OF_MODEL[exp] ?? "?"})` : "— (inherits session)";
  const overrides =
    agg.overrides.size === 0
      ? "none"
      : [...agg.overrides.entries()].map(([m, n]) => `${m}×${n}`).join(", ");
  console.log(
    `${agent.padEnd(25)}  ${String(agg.spawns).padStart(6)}  ${expLabel.padEnd(21)}  ${overrides}`,
  );
  for (const [m] of agg.overrides) {
    if (exp && m !== exp) {
      const dir =
        (TIER_OF_MODEL[m] ?? "?") === (TIER_OF_MODEL[exp] ?? "?")
          ? "lateral"
          : ["cheap", "mid", "top"].indexOf(TIER_OF_MODEL[m]) >
              ["cheap", "mid", "top"].indexOf(TIER_OF_MODEL[exp])
            ? "UP-tier"
            : "down-tier";
      notes.push(
        `${agent}: explicit ${m} override deviates from its ${exp} frontmatter (${dir}). ADR-022: escalations are fine when deliberate — this is the log that makes them visible.`,
      );
    }
  }
}

console.log("");
if (notes.length > 0) {
  console.log("Deviations from the ADR-022 tier table (observed, not enforced):");
  for (const n of notes) console.log(`  - ${n}`);
} else {
  console.log(
    "No explicit-override deviations observed — spawns rode their frontmatter tiers (ADR-022 adherence).",
  );
}
console.log(
  "\nTier table: docs/token-policy.md §Model-routing tiers. Observe-only (ADR-054 v1); always exits 0.",
);
process.exit(0);
