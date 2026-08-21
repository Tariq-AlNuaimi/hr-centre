#!/usr/bin/env node
// Context-tax meter (harness-v2 V2-101 / V2-103; widened by B1 2026-08-17).
//
// Measures the ALWAYS-ON bytes a fresh session pays BEFORE its first prompt. The original version
// measured 3 of 8 sources (constitution + agent-memory digest + handoff block) and reported ~11.8KB
// against a 20KB budget while the true tax was ~66KB — a meter that reads green because it is
// pointed at a third of the meal. Every source below is now counted, and any source that cannot be
// measured is reported as UNMEASURED rather than silently contributing 0 (the repo's own lesson:
// "a check that degrades quietly when a prerequisite is missing will read as green forever").
//
// Sources:
//   1. CLAUDE.md                  -- the constitution, auto-loaded as project instructions.
//   2. .claude/rules/*.md         -- MUST BE ABSENT. Anything under `.claude/` is auto-discovered
//                                    as project instructions and loaded into EVERY session, which
//                                    is exactly what the path-lazy rules-injection hook exists to
//                                    avoid. The rule files live in `docs/rules/` (NOT auto-loaded);
//                                    a file reappearing here is a REGRESSION and fails --strict.
//   3. docs/rules/*.md            -- lazy: injected by .claude/hooks/rules-injection.mjs only when
//                                    an edited path matches a rule's frontmatter globs. Reported
//                                    at 0 with the deferred size shown for context.
//   4. .claude/skills/*/SKILL.md  -- the skill roster: name + frontmatter `description` of every
//                                    skill is injected so the model can route to one.
//   5. .claude/agents/*.md        -- same, for subagents (name + description).
//   6. AGENTS.md                  -- cross-tool pointer; loaded by AGENTS.md-aware assistants.
//   7. agent-memory digest        -- the <!-- BEGIN/END:digest --> block session-start.sh echoes.
//   8. SessionStart banner        -- the literal text .claude/hooks/session-start.sh prints.
//      + handoff auto-status      -- the <!-- BEGIN/END:auto-status --> block, when present.
//
// Budgets: constitution <= 8KB (KICKOFF row 1 / V2-101 accept — unchanged, and hook-test enforced);
// total always-on <= 40KB (B1: set against the post-cut reality of ~32KB, of which the 34-skill
// roster is ~16KB and is the next thing to cut if this needs to come down further).
// Exit code is 0 (advisory/warn -- house fail-open governance pattern); pass `--strict` to exit 1
// when a budget is blown OR a source is UNMEASURED OR the .claude/rules regression is detected.
// `--json` prints a machine-readable summary.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const KB = 1024;
const CONSTITUTION_BUDGET = 8 * KB; // 8192
const TOTAL_BUDGET = 40 * KB; // 40960

const strict = process.argv.includes("--strict");
const asJson = process.argv.includes("--json");

const bytes = (s) => Buffer.byteLength(s, "utf8");

/** Read a repo-relative file. Returns null when it does not exist / cannot be read. */
function readSafe(p) {
  try {
    return readFileSync(join(ROOT, p), "utf8");
  } catch {
    return null;
  }
}

/** List *.md in a repo-relative dir. Returns null when the dir does not exist. */
function listMd(dir) {
  try {
    return readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return null;
  }
}

/** Frontmatter block of a markdown file ("" when there is none). */
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return m ? m[1] : "";
}

/** A (possibly multi-line) `key:` value out of a frontmatter block. */
function fmField(front, key) {
  const m = new RegExp(`^${key}:\\s*([\\s\\S]*?)(?=\\n[A-Za-z_-]+:\\s|$)`, "m").exec(front);
  return m ? m[1].trim() : "";
}

/** Extract a delimited block, e.g. digest / auto-status. */
function block(text, name) {
  const m = new RegExp(`<!-- BEGIN:${name}[\\s\\S]*?<!-- END:${name}[^>]*>`).exec(text);
  return m ? m[0] : "";
}

// Each entry: { key, label, bytes, status, note }
// status: "counted" | "lazy" | "unmeasured" | "regression"
const rows = [];
const add = (key, label, b, status = "counted", note = "") =>
  rows.push({ key, label, bytes: b, status, note });

// 1. Constitution ------------------------------------------------------------
const constitution = readSafe("CLAUDE.md");
if (constitution === null) {
  add("constitution", "CLAUDE.md (constitution)", 0, "unmeasured", "file not readable");
} else {
  add("constitution", "CLAUDE.md (constitution)", bytes(constitution));
}
const constitutionBytes = rows[0].bytes;

// 2. .claude/rules/*.md — must not exist (see header) -------------------------
const strayRules = listMd(".claude/rules");
if (strayRules && strayRules.length) {
  const b = strayRules.reduce((n, f) => n + bytes(readSafe(join(".claude/rules", f)) ?? ""), 0);
  add(
    "strayRules",
    ".claude/rules/*.md",
    b,
    "regression",
    `${strayRules.length} file(s) under .claude/ are auto-loaded into EVERY session — move them to docs/rules/`,
  );
} else {
  add("strayRules", ".claude/rules/*.md", 0, "counted", "absent (correct)");
}

// 3. docs/rules/*.md — lazy, injected on a matching edit ----------------------
const lazyRules = listMd("docs/rules");
if (lazyRules === null) {
  add("lazyRules", "docs/rules/*.md (lazy)", 0, "unmeasured", "docs/rules/ missing — rules lost?");
} else {
  const deferred = lazyRules.reduce((n, f) => n + bytes(readSafe(join("docs/rules", f)) ?? ""), 0);
  add(
    "lazyRules",
    "docs/rules/*.md (lazy)",
    0,
    "lazy",
    `${lazyRules.length} file(s), ${(deferred / KB).toFixed(1)}KB deferred — injected per matching edit`,
  );
}

// 4. Skill roster ------------------------------------------------------------
let skillDirs = null;
try {
  skillDirs = readdirSync(join(ROOT, ".claude", "skills"));
} catch {
  skillDirs = null;
}
if (skillDirs === null) {
  add("skills", "skill roster (name+description)", 0, "unmeasured", ".claude/skills/ not readable");
} else {
  let b = 0;
  let n = 0;
  for (const d of skillDirs) {
    const text = readSafe(join(".claude/skills", d, "SKILL.md"));
    if (text === null) continue;
    const front = frontmatter(text);
    b += bytes(`${fmField(front, "name") || d}: ${fmField(front, "description")}`);
    n++;
  }
  add("skills", "skill roster (name+description)", b, "counted", `${n} skills`);
}

// 5. Agent roster ------------------------------------------------------------
const agentFiles = listMd(".claude/agents");
if (agentFiles === null) {
  add("agents", "agent roster (name+description)", 0, "unmeasured", ".claude/agents/ not readable");
} else {
  let b = 0;
  for (const f of agentFiles) {
    const front = frontmatter(readSafe(join(".claude/agents", f)) ?? "");
    b += bytes(`${fmField(front, "name")}: ${fmField(front, "description")}`);
  }
  add("agents", "agent roster (name+description)", b, "counted", `${agentFiles.length} agents`);
}

// 6. AGENTS.md ---------------------------------------------------------------
const agentsMd = readSafe("AGENTS.md");
add(
  "agentsMd",
  "AGENTS.md (cross-tool pointer)",
  agentsMd === null ? 0 : bytes(agentsMd),
  "counted",
  agentsMd === null ? "absent" : "",
);

// 7. agent-memory digest -----------------------------------------------------
// Mirrors session-start.sh: only the <!-- BEGIN/END:digest --> block is echoed (V2-102); the full
// sections are retrieval-on-demand and are NOT a fixed tax.
const memory = readSafe("docs/agent-memory.md");
if (memory === null) {
  add("memory", "agent-memory digest", 0, "counted", "docs/agent-memory.md absent");
} else {
  const digest = block(memory, "digest");
  if (digest) add("memory", "agent-memory digest", bytes(digest), "counted");
  else
    add(
      "memory",
      "agent-memory digest",
      bytes(memory),
      "unmeasured",
      "no BEGIN/END:digest markers — the WHOLE file is echoed; counting it all",
    );
}

// 8. SessionStart banner + handoff auto-status -------------------------------
// The banner is branch-dependent (warnings fire conditionally), so this sums EVERY literal
// echo/printf string in the hook: an honest UPPER BOUND, labelled as one.
const startHook = readSafe(".claude/hooks/session-start.sh");
if (startHook === null) {
  add("banner", "SessionStart banner", 0, "unmeasured", "session-start.sh not readable");
} else {
  let b = 0;
  for (const m of startHook.matchAll(/^\s*(?:echo|printf)\s+(?:-n\s+)?(["'])([\s\S]*?)\1/gm)) {
    b += bytes(m[2]) + 1;
  }
  add("banner", "SessionStart banner", b, "counted", "upper bound — branch-dependent");
}

// The auto-status block is always-on only if SessionStart PRINTS it. It stopped doing
// that on 2026-08-21 (the standing directive + tables were removed), so counting the
// file's bytes would over-report a cost no session actually pays -- and this meter
// existing to under-report by 3-of-8 sources is precisely why it was rebuilt. Measured
// from the HOOK, not the file, so it self-corrects if the surfacing ever returns.
const sessionStartSh = readSafe(".claude/hooks/session-start.sh") ?? "";
const handoffSurfaced = /BEGIN:auto-status/.test(sessionStartSh);
const handoff = readSafe("docs/SESSION-HANDOFF.md");
add(
  "handoff",
  "handoff auto-status block",
  !handoffSurfaced || handoff === null ? 0 : bytes(block(handoff, "auto-status")),
  "counted",
  !handoffSurfaced
    ? "not surfaced by SessionStart (removed 2026-08-21) -- costs nothing"
    : handoff === null
      ? "absent (gitignored in-flight state)"
      : "",
);

// ---------------------------------------------------------------------------
const total = rows.reduce((n, r) => n + r.bytes, 0);
const unmeasured = rows.filter((r) => r.status === "unmeasured");
const regressions = rows.filter((r) => r.status === "regression");

const summary = {
  rows,
  total,
  constitutionBytes,
  constitutionBudget: CONSTITUTION_BUDGET,
  totalBudget: TOTAL_BUDGET,
  constitutionOk: constitutionBytes <= CONSTITUTION_BUDGET,
  totalOk: total <= TOTAL_BUDGET,
  unmeasured: unmeasured.map((r) => r.key),
  regressions: regressions.map((r) => r.key),
  complete: unmeasured.length === 0 && regressions.length === 0,
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const kb = (n) => (n / KB).toFixed(2) + "KB";
  const mark = { counted: "  ", lazy: "  ", unmeasured: "??", regression: "!!" };
  console.log("SessionStart context tax (always-on bytes):");
  for (const r of rows) {
    const val = r.status === "lazy" ? "lazy" : r.bytes.toString();
    console.log(
      `  ${mark[r.status]} ${r.label.padEnd(34)}: ${val.padStart(6)}  ` +
        `${r.status === "lazy" ? "" : `(${kb(r.bytes)})`.padStart(10)}` +
        `${r.note ? `  ${r.note}` : ""}`,
    );
  }
  console.log(
    `     ${"TOTAL".padEnd(34)}: ${total.toString().padStart(6)}  ${`(${kb(total)})`.padStart(10)}  ` +
      `${summary.totalOk ? "OK" : "OVER"} vs ${TOTAL_BUDGET / KB}KB`,
  );
  console.log(
    `     ${"of which CLAUDE.md".padEnd(34)}: ${constitutionBytes.toString().padStart(6)}  ` +
      `${`(${kb(constitutionBytes)})`.padStart(10)}  ${summary.constitutionOk ? "OK" : "OVER"} vs 8KB`,
  );
  if (!summary.constitutionOk)
    console.log(
      `  WARN: constitution ${constitutionBytes - CONSTITUTION_BUDGET} bytes over the 8KB budget.`,
    );
  if (!summary.totalOk)
    console.log(
      `  WARN: total ${total - TOTAL_BUDGET} bytes over the ${TOTAL_BUDGET / KB}KB budget.`,
    );
  for (const r of regressions) console.log(`  !! REGRESSION: ${r.label} — ${r.note}`);
  for (const r of unmeasured)
    console.log(`  ?? UNMEASURED: ${r.label} — ${r.note}. This total is NOT trustworthy.`);
  if (summary.complete && summary.totalOk && summary.constitutionOk)
    console.log("  All 8 always-on sources measured; both budgets OK.");
}

if (strict && !(summary.constitutionOk && summary.totalOk && summary.complete)) process.exit(1);
process.exit(0);
