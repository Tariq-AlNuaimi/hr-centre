#!/usr/bin/env node
// scripts/scaffold-ai-endpoint.mjs
//
// Scaffold a complete AI endpoint end-to-end (ADR-036, WS-5 follow-on): a POST route
// + zod input + eval fixtures + a blueprint stub, all consuming the shipped lib/ai
// barrel. Parallels scripts/scaffold-entity.mjs. The point is that the cross-cutting
// wiring a hand-written AI route always re-derives (and sometimes skips) is baked in
// by construction:
//   - isAiConfigured() -> 503 when the AI layer is unconfigured (honest failure)
//   - withRateLimit(withAuth|withEditorAuth|withAdminAuth(...)) with the rate limit
//     OUTERMOST (no-rate-limit-inside-auth rule; the model call is the expensive part)
//   - zod safeParse at the boundary -> 400 on invalid input
//   - the model reached ONLY through @/lib/ai (never `new Anthropic(...)`)
//   - the model call wrapped in withAiSpan() via withAiRoute (GenAI-semconv trace,
//     ADR-044): request attrs set by withAiRoute, response attrs (usage/finish
//     reason) set on the handed span via setAiResponseAttributes; no-op when OTel off
//   - an eval fixture so the deferred ai-eval gate (WS-5 part b) has something to score
//
// The generator writes via fs (a plain Node process), so the PreToolUse blueprint /
// build-vs-buy hooks — which only intercept Claude's Write/Edit tools — do not fire on
// its output; the emitted blueprint stub is what keeps a later human edit of the route
// gate-clean.
//
// Usage:
//   npm run scaffold-ai-endpoint -- --name Summarize
//   npm run scaffold-ai-endpoint -- --name Classify --input text:string,verbose:boolean \
//       --writes editor --rate-limit 10
//   npm run scaffold-ai-endpoint -- --name Summarize --dry-run

import { writeFile, mkdir, stat, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

const ROOT = process.cwd();

// The blueprint's Tier section must reflect THIS repo's tier at generation time,
// not a hardcoded value (a personal fork should not emit a `shared` stub). Read it
// from project.config.json; fall back to `personal` (the config default) if the
// file is missing or unreadable.
async function readProjectTier() {
  try {
    const raw = await readFile(join(ROOT, "project.config.json"), "utf8");
    const tier = JSON.parse(raw).tier;
    return tier === "shared" ? "shared" : "personal";
  } catch {
    return "personal";
  }
}
const projectTier = await readProjectTier();

// --- args -------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    name: { type: "string", short: "n" },
    input: { type: "string", default: "prompt:string" },
    writes: { type: "string", default: "any" },
    "rate-limit": { type: "string", default: "20" },
    "dry-run": { type: "boolean", default: false },
  },
  strict: true,
});

function die(msg) {
  console.error(`ERROR: ${msg}`);
  console.error("See `head -30 scripts/scaffold-ai-endpoint.mjs` for usage.");
  process.exit(1);
}

if (!values.name) die("missing --name <PascalCase>");

const Pascal = values.name;
if (!/^[A-Z][A-Za-z0-9]*$/.test(Pascal)) {
  die(`invalid name "${Pascal}" -- must be PascalCase (e.g. Summarize).`);
}

const WRAPPERS = {
  any: "withAuth",
  editor: "withEditorAuth",
  admin: "withAdminAuth",
};
const authWrapper = WRAPPERS[values.writes];
if (!authWrapper) die(`invalid --writes "${values.writes}" -- one of: any | editor | admin.`);

if (!/^\d+$/.test(values["rate-limit"].trim())) {
  die(`invalid --rate-limit "${values["rate-limit"]}" -- a positive integer (requests/min).`);
}
const rateLimit = Number.parseInt(values["rate-limit"], 10);
if (!Number.isInteger(rateLimit) || rateLimit < 1) {
  die(`invalid --rate-limit "${values["rate-limit"]}" -- a positive integer (requests/min).`);
}

// --- name + input helpers ---------------------------------------------------

const kebab = Pascal.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const camel = Pascal.charAt(0).toLowerCase() + Pascal.slice(1);

const ZOD = { string: "z.string().min(1).max(10000)", number: "z.number()", boolean: "z.boolean()" };
const SAMPLE = { string: JSON.stringify("example input"), number: "1", boolean: "true" };

const fields = values.input.split(",").map((raw) => {
  const [fname, ftype] = raw.split(":").map((s) => s.trim());
  if (!fname || !/^[a-z][A-Za-z0-9]*$/.test(fname)) {
    die(`invalid input field "${raw}" -- expected camelCase name:type (type = string|number|boolean).`);
  }
  if (!ZOD[ftype]) die(`invalid type for "${fname}": "${ftype}" -- one of: string | number | boolean.`);
  return { name: fname, type: ftype };
});

const dupe = fields.map((f) => f.name).find((n, i, arr) => arr.indexOf(n) !== i);
if (dupe) die(`duplicate input field "${dupe}" -- each --input name must be unique.`);

const primary = fields.find((f) => f.type === "string");
if (!primary) {
  die("an AI endpoint needs at least one `string` input field to use as the prompt.");
}

// --- emitted templates ------------------------------------------------------

const validationImportPath = `@/lib/validations/ai-${kebab}`;
const schemaConst = `${camel}InputSchema`;
const rateLimitId = `ai-${kebab}`;

function routeTs() {
  return `// app/api/ai/${kebab}/route.ts
// AI endpoint — scaffolded by \`npm run scaffold-ai-endpoint\` (ADR-036, WS-5).
//
// Reaches the model ONLY through the lib/ai barrel (never \`new Anthropic(...)\`):
// runAgent() delegates to Anthropic's native beta Tool Runner, so adding a \`tools\`
// array below turns this single-shot completion into an agentic loop for free.
//
// The cross-cutting guard/parse/trace preamble (isAiConfigured() -> 503, zod
// safeParse -> 400, withAiSpan) lives ONCE in withAiRoute (@/lib/ai); auth +
// rate-limiting stay EXPLICIT here so the --writes wrapper is visible and
// withRateLimit stays OUTERMOST (no-rate-limit-inside-auth; the model call is the
// expensive downstream). withAiRoute sets the request-side GenAI attributes
// (gen_ai.system / .request.model / .request.max_tokens) and hands the handler the
// span; setAiResponseAttributes lands the response-side ones (token usage, finish
// reason) so an OTLP sink (Langfuse; ADR-044) renders this span as a generation.
// METADATA ONLY -- no prompt/completion text (opt-in via AI_TRACE_CONTENT).
import { ${authWrapper}, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { runAgent, withAiRoute, setAiResponseAttributes } from "@/lib/ai";
import { ${schemaConst} } from "${validationImportPath}";

export const POST = withRateLimit(
  ${authWrapper}(
    withAiRoute({ span: "ai.${kebab}", schema: ${schemaConst} }, async (input, _request, span) => {
      // TODO: craft the real prompt / system message from the validated input.
      const userMessage = input.${primary.name};

      const finalMessage = await runAgent({
        messages: [{ role: "user", content: userMessage }],
        // TODO: add \`tools: [...]\` to make this an agentic loop (native Tool Runner).
        tools: [],
      });

      // Response-side GenAI attributes (gen_ai.response.model / .usage.* /
      // .finish_reasons) on the active AI span -- METADATA ONLY (no prompt or
      // completion text; that is opt-in via AI_TRACE_CONTENT, default OFF).
      setAiResponseAttributes(span, finalMessage);

      const text = finalMessage.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("");

      return ok({ text });
    }),
  ),
  { id: "${rateLimitId}", limit: ${rateLimit}, windowMs: 60_000 },
);
`;
}

function validationTs() {
  const body = fields.map((f) => `  ${f.name}: ${ZOD[f.type]},`).join("\n");
  return `// lib/validations/ai-${kebab}.ts — zod input schema for POST /api/ai/${kebab}.
// Scaffolded by \`npm run scaffold-ai-endpoint\` (ADR-036, WS-5). Validated at the route
// boundary; this shape is also the contract each eval fixture's \`input\` must satisfy.
import { z } from "zod";

export const ${schemaConst} = z.object({
${body}
});

export type ${Pascal}Input = z.infer<typeof ${schemaConst}>;
`;
}

function evalTs() {
  const sampleInput = fields.map((f) => `${f.name}: ${SAMPLE[f.type]}`).join(", ");
  return `// tests/ai-evals/${kebab}.eval.ts — eval fixtures for POST /api/ai/${kebab}.
// Scaffolded by \`npm run scaffold-ai-endpoint\` (ADR-036, WS-5).
//
// DORMANT until the ai-eval gate lands (WS-5 follow-on part b): that gate discovers
// tests/ai-evals/*.eval.ts, sends each case's \`input\` through the endpoint, and scores
// the completion against \`asserts\` (substring checks + LLM-as-judge; Promptfoo / ADR-020).
// Self-contained (imports nothing) so it typechecks before the runner exists.

export interface AiEvalCase {
  /** Human-readable case name (shows in the eval report). */
  name: string;
  /** Endpoint input — must satisfy the route's zod schema (${schemaConst}). */
  input: Record<string, unknown>;
  /** Assertions scored against the model's completion. */
  asserts: Array<
    | { type: "contains"; value: string }
    | { type: "not-contains"; value: string }
    | { type: "llm-judge"; rubric: string }
  >;
}

export const cases: AiEvalCase[] = [
  {
    name: "${kebab} — happy path",
    input: { ${sampleInput} },
    asserts: [
      { type: "llm-judge", rubric: "The response correctly fulfils the request for this input." },
    ],
  },
  {
    name: "${kebab} — stays on task / no canned refusal",
    input: { ${sampleInput} },
    asserts: [{ type: "not-contains", value: "As an AI language model" }],
  },
];
`;
}

function blueprintMd() {
  // Assembled from lines (not a template literal) because the content is markdown
  // dense with backticks; joining an array sidesteps backtick-escaping.
  const inputList = fields.map((f) => `- \`${f.name}\` (${f.type})`).join("\n");
  return [
    `# Blueprint — AI endpoint: POST /api/ai/${kebab}`,
    ``,
    `Scope: app/api/ai/${kebab}/**`,
    ``,
    "> Scaffolded by `npm run scaffold-ai-endpoint` (ADR-036, WS-5). This stub exists so the",
    "> route is covered by the blueprint-gate (ADR-033) from birth. FLESH IT OUT before shipping:",
    "> real user stories, happy + worst-path scenarios, and the prompt / system-message design.",
    ``,
    `## Problem & outcome`,
    `<!-- TODO: what does this endpoint do, for whom, and what is the successful outcome? -->`,
    ``,
    `## Users & stories (EARS; worst path mandatory)`,
    `- **US1** — As a <role>, I want <capability>, so that <benefit>.`,
    `  - **AC-1.1** — WHEN <valid input> THE SYSTEM SHALL <behaviour>.`,
    `  - **AC-1.2 (worst)** — WHEN <invalid input / AI unconfigured> THE SYSTEM SHALL <safe failure>.`,
    ``,
    `## Inputs (zod: lib/validations/ai-${kebab}.ts)`,
    inputList,
    ``,
    `## Guardrails (baked in by the scaffold — do not remove)`,
    "- `isAiConfigured()` → 503 when the AI layer is unconfigured.",
    `- \`withRateLimit(${authWrapper}(...))\` — rate-limit OUTSIDE auth (limit ${rateLimit}/min).`,
    "- zod `safeParse` at the boundary → 400 on invalid input.",
    "- Model reached only via `@/lib/ai` (`runAgent`); call traced as a GenAI-semconv span via `withAiRoute`/`withAiSpan` (ADR-044).",
    ``,
    `## Evals`,
    `- Fixtures: \`tests/ai-evals/${kebab}.eval.ts\` (dormant until the ai-eval gate, WS-5 part b).`,
    ``,
    `## Tier`,
    `\`${projectTier}\`.`,
    ``,
  ].join("\n");
}

// --- emit -------------------------------------------------------------------

const outputs = [
  { path: `app/api/ai/${kebab}/route.ts`, content: routeTs() },
  { path: `lib/validations/ai-${kebab}.ts`, content: validationTs() },
  { path: `tests/ai-evals/${kebab}.eval.ts`, content: evalTs() },
  { path: `docs/blueprints/ai-${kebab}.md`, content: blueprintMd() },
];

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

const collisions = [];
for (const o of outputs) {
  if (await pathExists(join(ROOT, o.path))) collisions.push(o.path);
}
if (collisions.length > 0) {
  die(`refusing to overwrite existing file(s):\n  - ${collisions.join("\n  - ")}`);
}

if (values["dry-run"]) {
  console.log("--- DRY RUN (no files written) ---");
  for (const o of outputs) console.log(`would write ${o.path} (${o.content.length} bytes)`);
  process.exit(0);
}

for (const o of outputs) {
  const abs = join(ROOT, o.path);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, o.content);
  console.log(`+ ${o.path}`);
}

// --- summary ----------------------------------------------------------------

console.log("");
console.log(`Scaffolded AI endpoint POST /api/ai/${kebab} (${authWrapper}, ${rateLimit}/min). Next steps:`);
console.log(`  1. Fill in docs/blueprints/ai-${kebab}.md (real stories + worst path + prompt design).`);
console.log(`  2. Shape the prompt in app/api/ai/${kebab}/route.ts (search for the TODOs).`);
console.log(`  3. Add real cases to tests/ai-evals/${kebab}.eval.ts (dormant until the ai-eval gate).`);
console.log(`  4. Set AI_API_KEY (+ optional AI_BASE_URL/AI_AUTH_STYLE/AI_MODEL) to exercise it live.`);
console.log(`  5. Run: npm run ship`);
