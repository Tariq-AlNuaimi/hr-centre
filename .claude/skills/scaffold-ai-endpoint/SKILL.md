---
name: scaffold-ai-endpoint
description: Scaffold a complete AI endpoint end-to-end -- a POST API route (config-guarded, auth-wrapped, rate-limited, zod-validated, traced) + zod input schema + eval fixtures + a blueprint stub, all consuming the lib/ai skeleton (ADR-036). Backed by scripts/scaffold-ai-endpoint.mjs. Use when the user says "add an AI endpoint", "scaffold an LLM route", "new AI route for X", "/scaffold-ai-endpoint".
---

# Scaffold AI Endpoint

Generate a new AI endpoint that reaches the model through the shipped `lib/ai` seam
(ADR-036, WS-5). Codegen lives in `scripts/scaffold-ai-endpoint.mjs`; this skill
orchestrates inputs and reports the result. The generator BAKES IN the cross-cutting
wiring a hand-written AI route always re-derives (and sometimes skips), so a scaffolded
endpoint is `/ship`-green and Five-Pillars-correct on the first pass.

## Prerequisite — the lib/ai skeleton

This scaffold assumes the WS-5 skeleton (`lib/ai/*`, ADR-036) is present: `getAiClient`,
`runAgent`, `isAiConfigured` from `@/lib/ai`. The whole endpoint is a **silent no-op**
(returns 503) until `AI_API_KEY` is set — set `AI_API_KEY` (+ optional `AI_BASE_URL` /
`AI_AUTH_STYLE` / `AI_MODEL`) to exercise it live. The model is reached ONLY through the
barrel; a scaffolded route never constructs `new Anthropic(...)`.

## Before scaffolding — blueprint gate

The generator emits a **blueprint stub** (`docs/blueprints/ai-<kebab>.md` with a `Scope:`
glob covering the route), so the new route is covered by the blueprint-gate (ADR-033) from
birth. That stub is a skeleton, not a finished contract: **fill it in** — real user stories,
happy + worst-path scenarios, and the prompt / system-message design — before you ship. For
a throwaway `/quickstart` endpoint the stub alone satisfies the gate; for a real feature, do
the full `/blueprint` track and flesh the stub out. Designing the prompt and the failure
behaviour first is what stops a "the model does the wrong thing" rebuild after the fact.

## Inputs to gather

- **Endpoint name** (PascalCase, verb-ish). Examples: `Summarize`, `Classify`, `Extract`.
  → route `app/api/ai/<kebab>/route.ts` (e.g. `Summarize` → `app/api/ai/summarize`).
- **Input fields** (optional): `--input name:type,...`
  - types: `string`, `number`, `boolean`
  - Default: `prompt:string`. At least one **string** field is required (it becomes the
    prompt text; the first string field is used).
- **Who can call it?** `--writes any|editor|admin` selects the auth wrapper:
  - `any` → `withAuth` (any authenticated user) — **default**
  - `editor` → `withEditorAuth` (ADMIN or EDITOR; rejects VIEWER)
  - `admin` → `withAdminAuth` (ADMIN only)
  - AI endpoints are **never public** — a public model call is a cost/abuse vector.
- **Rate limit** (requests/min): `--rate-limit 20` (default). The limit composes
  **OUTSIDE** the auth wrapper (a flood is throttled before the expensive model call).
- **`--dry-run`**: print what would be written without touching the tree.

## Examples

Minimal (default `prompt:string`, any authenticated caller, 20/min):

```
npm run scaffold-ai-endpoint -- --name Summarize
```

Custom input, editor-only, tighter limit:

```
npm run scaffold-ai-endpoint -- --name Classify \
  --input 'text:string,verbose:boolean' \
  --writes editor \
  --rate-limit 10
```

Preview only:

```
npm run scaffold-ai-endpoint -- --name Extract --dry-run
```

## After scaffolding

1. **Fill in the blueprint** `docs/blueprints/ai-<kebab>.md` — real user stories, happy +
   worst-path scenarios, and the prompt design. The stub is a starting point, not a spec.
2. **Shape the prompt** in `app/api/ai/<kebab>/route.ts` (search for the `TODO`s): craft
   the real user/system message from the validated input, and add `tools: [...]` if the
   endpoint should be an agentic loop (the native Tool Runner drives it).
3. **Add real eval cases** to `tests/ai-evals/<kebab>.eval.ts` — the fixtures are dormant
   until the ai-eval gate lands (WS-5 follow-on part b), but write them now so the endpoint
   is born checkable.
4. Set `AI_API_KEY` (+ optional `AI_BASE_URL` / `AI_AUTH_STYLE` / `AI_MODEL`) to run it live.
5. Run `npm run ship`.

## What gets generated

- `app/api/ai/<kebab>/route.ts` — a POST endpoint:
  - `isAiConfigured()` guard → **503** when the AI layer is unconfigured (honest failure,
    mirrors the skeleton's degradation; never reaches the SDK's `AiNotConfiguredError`).
  - `withRateLimit(<withAuth|withEditorAuth|withAdminAuth>(handler), { id: "ai-<kebab>",
limit: <n>, windowMs: 60000 })` — the write wrapper is chosen by `--writes`, rate-limit
    **outermost**.
  - `safeParse` of the body with the emitted zod schema → **400** with the zod messages.
  - the model call via `runAgent({ messages, tools: [] })`, wrapped in
    `withSpan("ai.<kebab>", ...)` (WS-4 tracing; no-op when OTel is off).
  - text extracted from `finalMessage.content` (the `type: "text"` blocks) and returned as
    `{ text }`.
- `lib/validations/ai-<kebab>.ts` — `<camel>InputSchema` (zod) + the inferred input type.
- `tests/ai-evals/<kebab>.eval.ts` — typed `AiEvalCase[]` fixtures (self-contained; imports
  nothing). Contract for the deferred ai-eval gate: `name`, `input` (matching the zod shape),
  and `asserts` of `contains` / `not-contains` / `llm-judge`.
- `docs/blueprints/ai-<kebab>.md` — a `Scope:`-bearing blueprint stub for the route.

## What gets patched

- Nothing. Unlike `/scaffold-entity`, an AI endpoint needs no Prisma model, sidebar nav,
  recycling-bin registration, or i18n namespace — it's a stateless API route.

## Hard rules preserved

- The model is reached **only** through `@/lib/ai` (`runAgent` / `getAiClient`) — never a
  raw `new Anthropic(...)`. Endpoint (base URL / auth style / model) stays deploy-time config.
- `withRateLimit` composes **OUTSIDE** the auth wrapper (`no-rate-limit-inside-auth`) so a
  flood is throttled before any auth or model work.
- The handler is never bare — always `withAuth` / `withEditorAuth` / `withAdminAuth`.
- zod `safeParse` guards the boundary before the model is called; invalid input → 400.
- Honest states: 503 when unconfigured, 400 on bad input — no green response over a failure.
- The model call is wrapped in `withSpan` so it is traced when observability is on.

## Do NOT

- Do NOT make an AI endpoint public (no bare route, no bypassing the auth wrapper) — a public
  model call is a direct cost/abuse vector.
- Do NOT drop `withRateLimit` or move it inside the auth wrapper.
- Do NOT construct `new Anthropic(...)` in the route — always go through `@/lib/ai`.
- Do NOT log the prompt or completion if it may carry Restricted/PII input (SECURITY.md §1);
  trace span names, not payloads.

## Idempotency

Refuses to overwrite. If any of the four target files
(`app/api/ai/<kebab>/route.ts`, `lib/validations/ai-<kebab>.ts`,
`tests/ai-evals/<kebab>.eval.ts`, `docs/blueprints/ai-<kebab>.md`) already exists, the
generator exits non-zero naming the collision and writes nothing. To regenerate after a
typo, delete the four files and re-run.
