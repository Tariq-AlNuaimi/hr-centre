---
name: ai-eval
description: Score AI endpoints against eval fixtures with substring checks + LLM-as-judge (ADR-036, WS-5). Discovers tests/ai-evals/*.eval.ts, POSTs each case to POST /api/ai/<kebab>, and grades the completion; dormant (exit 0) until AI_API_KEY is set AND fixtures exist. Use when the user says "ai eval", "llm eval", "score AI endpoint", "run the evals", "/ai-eval".
---

# AI Eval (LLM-as-judge)

Run the eval fixtures against your AI endpoints and score the completions. The
runner lives in `scripts/ai-eval.mjs`; this skill orchestrates it. Every AI endpoint
scaffolded by `/scaffold-ai-endpoint` is born with a `tests/ai-evals/<kebab>.eval.ts`
fixture — this is the gate that finally **runs** them, closing the loop the scaffold
opened.

## How to run

```
npm run ai-eval
```

Against a deployed app instead of local dev:

```
AI_EVAL_BASE_URL=https://your-app.vercel.app npm run ai-eval
```

## Dormant until configured (why THIS repo stays green)

The runner is a **no-op that exits 0** — exactly like the dormant `lhci` / coverage
gates — until BOTH are true:

1. **The AI layer is configured** — `AI_API_KEY` is set (`isAiConfigured()`), AND
2. **Fixtures exist** — at least one `tests/ai-evals/*.eval.ts`.

With neither (the pristine template, or a fork that hasn't turned AI on), it prints a
`SKIP` note and exits green, so `/ship` stays green with no AI key and no fixtures. A
fork that sets `AI_API_KEY`, writes fixtures, and runs the app gets a real, scored
quality gate — no code change, just configuration.

## The fixture contract

Each `tests/ai-evals/<kebab>.eval.ts` exports `cases` (the shape `/scaffold-ai-endpoint`
emits):

```ts
export interface AiEvalCase {
  name: string; // shows in the report
  input: Record<string, unknown>; // must satisfy the route's zod schema
  asserts: Array<
    | { type: "contains"; value: string }
    | { type: "not-contains"; value: string }
    | { type: "llm-judge"; rubric: string }
  >;
}
export const cases: AiEvalCase[] = [/* ... */];
```

The filename maps to the endpoint: `summarize.eval.ts` → `POST /api/ai/summarize`
(the same path `/scaffold-ai-endpoint` generates). The runner POSTs each case's
`input` to `${AI_EVAL_BASE_URL}/api/ai/<kebab>` and reads the completion from the
route's `{ data: { text } }` response.

## Scoring

- **`contains`** — the substring MUST appear in the completion (case-insensitive).
- **`not-contains`** — the substring MUST NOT appear (e.g. a canned refusal, a leaked
  system-prompt marker, a forbidden term).
- **`llm-judge`** — the runner asks the model (through `@/lib/ai` — `runAgent`, never a
  raw `new Anthropic(...)`) to grade the completion against your `rubric`, returning
  PASS/FAIL with a one-line reason. This is the "did it actually do the right thing?"
  check that substring assertions can't express.

A case **fails** if any assert fails or the request errors (non-2xx, connection
refused). The runner exits non-zero when any case fails; `/ship` treats that as RED and
a clean skip / all-pass as PASS.

## Auth-wrapped endpoints

AI routes are never public (`withAuth` / `withEditorAuth` / `withAdminAuth`). If a POST
comes back 401/403, hand the runner a session — both are optional and never logged:

- `AI_EVAL_AUTH="Bearer <token>"` → sent as the `Authorization` header.
- `AI_EVAL_COOKIE="<name>=<value>"` → sent as the `Cookie` header.

## The /ship gate

`scripts/ship.mjs` runs `scripts/ai-eval.mjs` as a **fork-conditional** phase (ADR-020
dormancy pattern, parallel to `lhci`): the skip path above means it is inert in the
template and in any un-configured fork, then activates the moment a fork configures AI +
writes fixtures + runs the app. It is a wave-off in `docs/findings-register.md`
(dormant-until-configured, fork/CI-activated) so its dormancy is a recorded decision, not
a silent gap.

## Do NOT

- Do NOT reach the model any way but `@/lib/ai` — the judge goes through `runAgent`.
- Do NOT log the API key, raw prompts, or full completions (they may carry Restricted
  input, SECURITY.md §1) — the runner prints assert-level PASS/FAIL + short reasons only.
- Do NOT make the gate hard-fail when unconfigured — dormancy (exit 0) is the design.
