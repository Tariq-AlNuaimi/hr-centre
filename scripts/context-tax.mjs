#!/usr/bin/env node
// Context-tax meter (harness-v2 V2-101 / V2-103).
//
// Measures the ALWAYS-ON bytes a fresh session pays at SessionStart, BEFORE its first prompt:
//   1. CLAUDE.md            -- the constitution, auto-loaded as project instructions.
//   2. agent-memory surface -- what session-start.sh echoes from docs/agent-memory.md
//                              (whole file when <=150 lines, else head -60; mirrors the hook).
//   3. handoff auto-status  -- the <!-- BEGIN/END:auto-status --> block session-start.sh prints.
// The `.claude/rules/*.md` files are DELIBERATELY excluded: they load lazily per path
// (rules-injection.mjs), so they are not an always-on tax.
//
// Budgets (KICKOFF row 1 / V2-101 accept): constitution <= 8KB; total always-on <= 20KB.
// Exit code is 0 (advisory/warn -- house fail-open governance pattern); pass `--strict` to exit 1
// when a budget is blown (used by tests). `--json` prints a machine-readable summary.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const KB = 1024;
const CONSTITUTION_BUDGET = 8 * KB; // 8192
const TOTAL_BUDGET = 20 * KB; // 20480

const strict = process.argv.includes("--strict");
const asJson = process.argv.includes("--json");

function bytes(s) {
  return Buffer.byteLength(s, "utf8");
}
function readSafe(p) {
  try {
    return readFileSync(join(ROOT, p), "utf8");
  } catch {
    return "";
  }
}

// 1. Constitution.
const constitution = readSafe("CLAUDE.md");
const constitutionBytes = bytes(constitution);

// 2. agent-memory surface -- replicate session-start.sh: only the <!-- BEGIN/END:digest --> block
// is surfaced (retrieval-on-demand, V2-102); full sections load on demand and are not a fixed tax.
const memory = readSafe("docs/agent-memory.md");
let memorySurface = "";
if (memory) {
  const m = /<!-- BEGIN:digest[\s\S]*?<!-- END:digest[^>]*>/.exec(memory);
  memorySurface = m ? m[0] : memory; // digest block only; fall back to whole file if unmarked
}
const memoryBytes = bytes(memorySurface);

// 3. handoff auto-status block.
const handoff = readSafe("docs/SESSION-HANDOFF.md");
let handoffBlock = "";
if (handoff) {
  const m = /<!-- BEGIN:auto-status[\s\S]*?<!-- END:auto-status[^>]*>/.exec(handoff);
  handoffBlock = m ? m[0] : "";
}
const handoffBytes = bytes(handoffBlock);

const total = constitutionBytes + memoryBytes + handoffBytes;

const summary = {
  constitutionBytes,
  memoryBytes,
  handoffBytes,
  total,
  constitutionBudget: CONSTITUTION_BUDGET,
  totalBudget: TOTAL_BUDGET,
  constitutionOk: constitutionBytes <= CONSTITUTION_BUDGET,
  totalOk: total <= TOTAL_BUDGET,
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const kb = (n) => (n / KB).toFixed(2) + "KB";
  console.log("SessionStart context tax (always-on bytes):");
  console.log(
    `  CLAUDE.md (constitution) : ${constitutionBytes.toString().padStart(6)}  (${kb(constitutionBytes)})  ` +
      `${summary.constitutionOk ? "OK" : "OVER"} vs 8KB`,
  );
  console.log(
    `  agent-memory surface     : ${memoryBytes.toString().padStart(6)}  (${kb(memoryBytes)})`,
  );
  console.log(
    `  handoff auto-status      : ${handoffBytes.toString().padStart(6)}  (${kb(handoffBytes)})`,
  );
  console.log(
    `  TOTAL                    : ${total.toString().padStart(6)}  (${kb(total)})  ` +
      `${summary.totalOk ? "OK" : "OVER"} vs 20KB`,
  );
  if (!summary.constitutionOk)
    console.log(
      `  WARN: constitution ${constitutionBytes - CONSTITUTION_BUDGET} bytes over the 8KB budget.`,
    );
  if (!summary.totalOk)
    console.log(`  WARN: total ${total - TOTAL_BUDGET} bytes over the 20KB budget.`);
}

if (strict && (!summary.constitutionOk || !summary.totalOk)) process.exit(1);
process.exit(0);
