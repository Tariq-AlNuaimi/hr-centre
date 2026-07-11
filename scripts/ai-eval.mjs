#!/usr/bin/env node
// scripts/ai-eval.mjs — the LLM-as-judge eval runner + the /ship AI-eval gate
// (ADR-036, WS-5 follow-on part b). Parallels the dormant lhci / coverage gates:
// it is a NO-OP that exits 0 (green) until BOTH (a) the AI layer is configured
// (AI_API_KEY set) AND (b) eval fixtures exist under tests/ai-evals/. So the
// pristine template — no AI key, no fixtures — always skips cleanly and /ship
// stays green; a fork that turns the AI layer on and writes fixtures gets a real,
// scored quality gate for free.
//
// WHAT IT DOES (when live):
//   1. Discover tests/ai-evals/*.eval.ts fixtures. Each exports `cases`
//      (AiEvalCase[]): { name, input, asserts: Array<
//        | { type: "contains";      value: string }
//        | { type: "not-contains";  value: string }
//        | { type: "llm-judge";     rubric: string } > }.
//      This is the exact shape scripts/scaffold-ai-endpoint.mjs emits.
//   2. Map each fixture file <kebab>.eval.ts -> the endpoint POST /api/ai/<kebab>
//      (mirrors the scaffold's route path), and POST each case's `input` to
//      `${AI_EVAL_BASE_URL}/api/ai/<kebab>` (default http://localhost:3000).
//   3. Read the completion from the route's `{ data: { text } }` response
//      (the scaffolded route returns ok({ text })), then score every assert:
//        - contains      -> substring MUST appear (case-insensitive)
//        - not-contains  -> substring MUST NOT appear
//        - llm-judge     -> ask the model (via @/lib/ai — never `new Anthropic`)
//                           to grade the completion against the rubric -> PASS/FAIL
//   4. Exit non-zero if any case fails (any failing assert or a failed request);
//      exit 0 when every case passes.
//
// HARD RULES: the model is reached ONLY through lib/ai (getAiClient/runAgent) for
// the judge; no secret/PII is logged (the API key and raw prompts/completions are
// never printed — only assert-level PASS/FAIL + short reasons). Fixtures and the
// lib/ai TypeScript source are loaded through tsx's programmatic loader (the repo
// already runs its test suites under `--import tsx`), so the npm script stays a
// plain `node scripts/ai-eval.mjs`.

import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FIXTURE_DIR = "tests/ai-evals";
const BASE_URL = (process.env.AI_EVAL_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

// A fork whose AI endpoints are auth-wrapped (they always are — withAuth/withEditorAuth/
// withAdminAuth) can hand the runner a session so the POST isn't rejected 401. Both are
// optional and never logged. AI_EVAL_AUTH -> Authorization header; AI_EVAL_COOKIE -> Cookie.
const AUTH_HEADER = process.env.AI_EVAL_AUTH?.trim();
const COOKIE = process.env.AI_EVAL_COOKIE?.trim();

// --- dormancy gate (mirrors lhci / coverage skipping) -----------------------
// Skip cleanly (exit 0) when the AI layer is off OR there are no fixtures. This
// is what keeps the gate dormant in the pristine template and in any fork that
// hasn't turned AI on yet — /ship treats a 0 exit as PASS.
function aiConfigured() {
  const key = process.env.AI_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}
function discoverFixtures() {
  if (!existsSync(FIXTURE_DIR)) return [];
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".eval.ts"))
    .map((f) => ({ file: `${FIXTURE_DIR}/${f}`, kebab: f.replace(/\.eval\.ts$/, "") }))
    .sort((a, b) => a.kebab.localeCompare(b.kebab));
}

if (!aiConfigured()) {
  console.log("ai-eval: SKIP — AI layer is unconfigured (AI_API_KEY unset). Dormant, like lhci/coverage; exiting green.");
  process.exit(0);
}
const fixtures = discoverFixtures();
if (fixtures.length === 0) {
  console.log(`ai-eval: SKIP — no fixtures under ${FIXTURE_DIR}/ (*.eval.ts). Scaffold an endpoint to emit some; exiting green.`);
  process.exit(0);
}

// --- tsx loader (import .ts fixtures + lib/ai source from a .mjs script) -----
// The repo runs its suites under `--import tsx`; here we register tsx's ESM hook
// programmatically so the npm script stays a plain `node scripts/ai-eval.mjs`.
let unregister = () => {};
try {
  const tsx = await import("tsx/esm/api");
  unregister = tsx.register();
} catch (err) {
  console.error("ai-eval: FAIL — could not load the tsx loader (needed to import .ts fixtures + lib/ai).");
  console.error(`  ${err instanceof Error ? err.message : String(err)}`);
  console.error("  Fix: npm i -D tsx (already a devDependency in this template).");
  process.exit(1);
}

// The model is reached ONLY through the lib/ai barrel (never `new Anthropic(...)`).
// Loaded via a file URL so tsx transforms it and its relative imports.
const { runAgent } = await import(pathToFileURL(resolve("lib/ai/index.ts")).href);

// --- scoring helpers --------------------------------------------------------

/** Pull the model completion text out of the endpoint's `{ data: { text } }` body. */
function extractCompletion(body) {
  if (body && typeof body === "object") {
    if (typeof body.data?.text === "string") return body.data.text;
    if (typeof body.text === "string") return body.text;
  }
  // Fallback: stringify so a differently-shaped response is still scannable by
  // contains/not-contains (and visible to the judge) rather than silently empty.
  return typeof body === "string" ? body : JSON.stringify(body ?? "");
}

/** LLM-as-judge: grade a completion against a rubric via lib/ai. Returns { pass, reason }. */
async function llmJudge(rubric, completion) {
  const prompt =
    "You are a strict evaluation judge for an AI endpoint's output.\n" +
    "Decide whether the RESPONSE satisfies the RUBRIC.\n" +
    'Reply with exactly "PASS" or "FAIL" as the first word, then a one-line reason.\n\n' +
    `RUBRIC:\n${rubric}\n\n` +
    `RESPONSE:\n${completion}`;
  const finalMessage = await runAgent({
    messages: [{ role: "user", content: prompt }],
    tools: [],
    max_tokens: 512,
  });
  const verdict = (finalMessage.content || [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
  const pass = /^\s*pass\b/i.test(verdict);
  // Keep the reason short; never echo the full completion (may carry PII).
  const reason = verdict.replace(/^\s*(pass|fail)\b[:\s-]*/i, "").split("\n")[0].slice(0, 160);
  return { pass, reason: reason || (pass ? "meets rubric" : "does not meet rubric") };
}

/** Score one assert against a completion. Returns { ok, label }. */
async function scoreAssert(assert, completion) {
  const hay = completion.toLowerCase();
  switch (assert.type) {
    case "contains": {
      const ok = hay.includes(String(assert.value).toLowerCase());
      return { ok, label: `contains "${assert.value}"` };
    }
    case "not-contains": {
      const ok = !hay.includes(String(assert.value).toLowerCase());
      return { ok, label: `not-contains "${assert.value}"` };
    }
    case "llm-judge": {
      const { pass, reason } = await llmJudge(assert.rubric, completion);
      return { ok: pass, label: `llm-judge: ${reason}` };
    }
    default:
      return { ok: false, label: `unknown assert type "${assert?.type}"` };
  }
}

// --- run --------------------------------------------------------------------

console.log(`ai-eval: ${fixtures.length} fixture file(s) against ${BASE_URL} ...`);
let failed = 0;
let total = 0;

for (const { file, kebab } of fixtures) {
  const endpoint = `${BASE_URL}/api/ai/${kebab}`;
  let mod;
  try {
    mod = await import(pathToFileURL(resolve(file)).href);
  } catch (err) {
    console.error(`  FAIL  ${file} — could not import: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
    continue;
  }
  const cases = Array.isArray(mod.cases) ? mod.cases : [];
  if (cases.length === 0) {
    console.log(`  note  ${file} — exports no \`cases\`; nothing to score.`);
    continue;
  }

  for (const c of cases) {
    total++;
    let body;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(AUTH_HEADER ? { authorization: AUTH_HEADER } : {}),
          ...(COOKIE ? { cookie: COOKIE } : {}),
        },
        body: JSON.stringify(c.input ?? {}),
      });
      if (!res.ok) {
        console.error(`  FAIL  ${kebab} :: ${c.name} — POST ${endpoint} -> HTTP ${res.status}`);
        if (res.status === 401 || res.status === 403) {
          console.error("        (endpoint is auth-wrapped; pass a session via AI_EVAL_AUTH or AI_EVAL_COOKIE)");
        }
        failed++;
        continue;
      }
      body = await res.json().catch(() => null);
    } catch (err) {
      // Connection refused etc. — the app under test isn't reachable. Real failure.
      console.error(`  FAIL  ${kebab} :: ${c.name} — request error: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`        (is the app running at ${BASE_URL}? set AI_EVAL_BASE_URL for a deployed URL)`);
      failed++;
      continue;
    }

    const completion = extractCompletion(body);
    const asserts = Array.isArray(c.asserts) ? c.asserts : [];
    const results = [];
    for (const a of asserts) results.push(await scoreAssert(a, completion));
    const bad = results.filter((r) => !r.ok);
    if (bad.length === 0) {
      console.log(`  PASS  ${kebab} :: ${c.name} (${results.length} assert(s))`);
    } else {
      console.error(`  FAIL  ${kebab} :: ${c.name}`);
      for (const b of bad) console.error(`          - ${b.label}`);
      failed++;
    }
  }
}

unregister();

console.log("");
if (failed > 0) {
  console.error(`ai-eval: RED — ${failed}/${total} case(s) failed.`);
  process.exit(1);
}
console.log(`ai-eval: green — ${total}/${total} case(s) passed.`);
process.exit(0);
