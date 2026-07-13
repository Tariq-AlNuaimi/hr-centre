#!/usr/bin/env node
// scripts/agent-eval.mjs — the agent-eval golden-set runner (ADR-054):
// "who reviews the reviewers". The exact mirror of scripts/ai-eval.mjs one layer
// up: ai-eval scores a fork's PRODUCT AI endpoints; agent-eval scores our own
// harness review agents against tests/agent-evals/* fixtures — synthetic diffs
// with KNOWN planted defects (each derived from a real past escape) paired with
// the findings a good review MUST surface.
//
// DORMANT BY DEFAULT (same posture as ai-eval): exits 0 with a note unless
// AI_API_KEY is set AND fixture dirs exist, so the pristine template and every
// fork stay green. Observe-only v1 — deliberately NOT a /ship phase (blueprint:
// docs/blueprints/harness-plugin-agent-eval.md; promotion trigger in ADR-054:
// "a review agent regresses undetected in production").
//
// WHEN LIVE (AI_API_KEY set):
//   1. Discover tests/agent-evals/<fixture>/ dirs, each carrying input.diff +
//      optional context/* + expected-findings.json (shape documented in
//      tests/agent-evals/README.md).
//   2. Build a review prompt: the named agent's .claude/agents/<agent>.md body
//      (frontmatter stripped) + the fixture task + input.diff + context files.
//   3. Reach the model ONLY through @/lib/ai (runAgent — never `new Anthropic`),
//      via the tsx loader, exactly like ai-eval.mjs.
//   4. Score findings-RECALL against ground truth: an expected finding is FOUND
//      when every mustMentionAnyOf group has >=1 keyword in the review output
//      (case-insensitive). LLM-judged plausibility is deliberately NOT used
//      (ADR-054 Option A2 rejected: no ground truth = misses go unnoticed).
//   5. Exit 1 if any expected finding is missed; exit 0 when all are recalled.
//
// HARD RULES: no secret/PII in output — the review completion is never printed
// (only per-finding FOUND/MISSED labels); fixtures are synthetic by contract.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FIXTURE_DIR = "tests/agent-evals";

// --- dormancy gate (mirrors ai-eval) -----------------------------------------
function aiConfigured() {
  const key = process.env.AI_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}
function discoverFixtures() {
  if (!existsSync(FIXTURE_DIR)) return [];
  return readdirSync(FIXTURE_DIR)
    .filter((name) => {
      const dir = join(FIXTURE_DIR, name);
      return (
        statSync(dir).isDirectory() &&
        existsSync(join(dir, "input.diff")) &&
        existsSync(join(dir, "expected-findings.json"))
      );
    })
    .sort();
}

if (!aiConfigured()) {
  console.log(
    "agent-eval: SKIP — AI layer is unconfigured (AI_API_KEY unset). Dormant, like ai-eval; exiting green.",
  );
  process.exit(0);
}
const fixtures = discoverFixtures();
if (fixtures.length === 0) {
  console.log(
    `agent-eval: SKIP — no fixture dirs under ${FIXTURE_DIR}/ (need input.diff + expected-findings.json). Exiting green.`,
  );
  process.exit(0);
}

// --- tsx loader (import lib/ai TypeScript from a .mjs script) ----------------
let unregister = () => {};
try {
  const tsx = await import("tsx/esm/api");
  unregister = tsx.register();
} catch (err) {
  console.error("agent-eval: FAIL — could not load the tsx loader (needed for lib/ai).");
  console.error(`  ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
// The model is reached ONLY through the lib/ai barrel (never `new Anthropic`).
const { runAgent } = await import(pathToFileURL(resolve("lib/ai/index.ts")).href);

// --- prompt assembly ----------------------------------------------------------

/** Load an agent's persona from .claude/agents/<name>.md, frontmatter stripped. */
function agentPersona(name) {
  const file = join(".claude/agents", `${name}.md`);
  if (!existsSync(file)) return `You are ${name}, a rigorous senior code reviewer.`;
  const src = readFileSync(file, "utf8");
  return src.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

/** Gather optional context/* files as labelled blocks. */
function contextBlocks(dir) {
  const ctxDir = join(dir, "context");
  if (!existsSync(ctxDir)) return "";
  return readdirSync(ctxDir)
    .sort()
    .map((f) => `--- context file: ${f} ---\n${readFileSync(join(ctxDir, f), "utf8")}`)
    .join("\n");
}

// --- run ----------------------------------------------------------------------

console.log(`agent-eval: ${fixtures.length} golden fixture(s) ...`);
let failed = 0;

for (const name of fixtures) {
  const dir = join(FIXTURE_DIR, name);
  let expected;
  try {
    expected = JSON.parse(readFileSync(join(dir, "expected-findings.json"), "utf8"));
  } catch (err) {
    console.error(`  FAIL  ${name} — bad expected-findings.json: ${err.message}`);
    failed++;
    continue;
  }
  const diff = readFileSync(join(dir, "input.diff"), "utf8");
  const prompt = [
    agentPersona(expected.agent || "senior-code-reviewer"),
    "",
    "TASK: " +
      (expected.task ||
        "Review the following diff. Report every defect a senior reviewer must surface, with severity."),
    "",
    "--- diff under review (input.diff) ---",
    diff,
    contextBlocks(dir),
    "",
    "Respond with a numbered findings list: severity, what is wrong, and why it matters.",
  ].join("\n");

  let review = "";
  try {
    const finalMessage = await runAgent({
      messages: [{ role: "user", content: prompt }],
      tools: [],
      max_tokens: 2048,
    });
    review = (finalMessage.content || [])
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .toLowerCase();
  } catch (err) {
    console.error(
      `  FAIL  ${name} — model call failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    failed++;
    continue;
  }

  // Findings-recall: every mustMentionAnyOf group needs >=1 keyword present.
  const misses = [];
  for (const finding of expected.expectedFindings || []) {
    const groups = finding.mustMentionAnyOf || [];
    const missedGroups = groups.filter(
      (group) => !group.some((kw) => review.includes(String(kw).toLowerCase())),
    );
    if (missedGroups.length > 0) {
      misses.push(
        `${finding.class} [${finding.severity}] — no mention of ${missedGroups
          .map((g) => `(${g.join(" | ")})`)
          .join(" and ")}`,
      );
    }
  }
  if (misses.length === 0) {
    console.log(
      `  PASS  ${name} (${(expected.expectedFindings || []).length} planted finding(s) recalled)`,
    );
  } else {
    console.error(`  FAIL  ${name} — reviewer MISSED planted finding(s):`);
    for (const m of misses) console.error(`          - ${m}`);
    failed++;
  }
}

unregister();

console.log("");
if (failed > 0) {
  console.error(
    `agent-eval: RED — ${failed}/${fixtures.length} fixture(s) failed. A review agent regressed on a known defect class; fix the agent prompt (or the fixture, if the defect class genuinely moved) before relying on its reviews.`,
  );
  process.exit(1);
}
console.log(`agent-eval: green — ${fixtures.length}/${fixtures.length} fixture(s) passed.`);
process.exit(0);
