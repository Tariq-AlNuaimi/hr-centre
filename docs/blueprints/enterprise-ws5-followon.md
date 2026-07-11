# Blueprint — Enterprise WS-5 follow-on: `/scaffold-ai-endpoint` generator

Scope: scripts/scaffold-ai-endpoint.mjs, .claude/skills/scaffold-ai-endpoint/**, tests/ai-evals/**

> Governs the FIRST follow-on increment on top of the shipped WS-5 AI skeleton
> (`docs/blueprints/enterprise-ws5-ai-layer.md`, ADR-036). It adds a generator that
> **emits** AI endpoints; it does not itself hand-write an `app/api/**/route.ts` or
> `app/**/page.tsx` (the generator writes those at run time via `fs`, and emits a
> per-endpoint blueprint stub so a generated route is gate-covered from birth). This
> file is the requirements contract `/qa`/`/uat` trace against. Decision of record:
> **ADR-036** (the deferred "`/scaffold-ai-endpoint`" line). Build-vs-buy recorded in
> `docs/build-vs-buy-ledger.md` (2026-07-11 — AI endpoint scaffolder).

## Problem & outcome
The WS-5 skeleton (`lib/ai/*`) shipped the provider seam + native Tool-Runner wrapper, but
building an actual AI endpoint by hand still means re-deriving the same wiring every time:
the `isAiConfigured()` 503 guard, an auth wrapper, `withRateLimit` **outside** auth (AI calls
are the expensive downstream — a flood must be throttled before the model is hit), zod at the
boundary, a `withSpan` trace (WS-4), the correct import of `runAgent`/`getAiClient` (never
`new Anthropic(...)`), and — the piece hand-rolling always skips — an **eval fixture** so the
endpoint's output quality is checkable. That drift is exactly what the enforcement trio
(build-vs-buy → blueprint → complexity) exists to prevent.

This increment lands **`/scaffold-ai-endpoint`** — a generator that parallels `/scaffold-entity`:
one command emits a correct, gated, traced, rate-limited AI route + its zod input + an eval
fixture + a blueprint stub, all consuming the shipped `lib/ai` barrel. When it ships, a
developer runs `npm run scaffold-ai-endpoint -- --name Summarize` and gets a route that is
`/ship`-green and `senior-review`-shaped on the first pass instead of at QA.

## Users & stories (EARS; worst path mandatory)
- **US1** — As a **developer**, I want one command to emit a complete AI endpoint, so that the
  cross-cutting wiring (config guard, auth, rate-limit, zod, tracing, provider import) is
  correct by construction and not re-derived per route.
  - **AC-1.1** — WHEN `npm run scaffold-ai-endpoint -- --name <Pascal>` runs THE SYSTEM SHALL
    emit `app/api/ai/<kebab>/route.ts` (POST), `lib/validations/ai-<kebab>.ts`,
    `tests/ai-evals/<kebab>.eval.ts`, and `docs/blueprints/ai-<kebab>.md` (with a `Scope:`
    glob covering the route), and SHALL print the manual follow-up steps.
  - **AC-1.2 (worst)** — WHEN any of the four target files already exists THE SYSTEM SHALL
    refuse to overwrite and exit non-zero, naming the collision (idempotency; matches
    `/scaffold-entity`).
- **US2** — As a **security/ops reviewer**, I want every generated route to satisfy the Five
  Pillars floor, so that a scaffolded endpoint never lowers the security bar.
  - **AC-2.1** — The emitted route SHALL: guard with `isAiConfigured()` returning **503** when
    the layer is unconfigured (honest failure, mirrors the skeleton); compose
    `withRateLimit(withAuth|withEditorAuth|withAdminAuth(...))` with the rate-limit **outermost**
    (no-rate-limit-inside-auth rule); `safeParse` the body with the emitted zod schema and
    return **400** on failure; reach the model **only** through `runAgent`/`getAiClient` from
    `@/lib/ai`; and wrap the model call in `withSpan(...)` (WS-4).
  - **AC-2.2 (worst)** — WHEN the request body is missing/invalid THE SYSTEM SHALL return 400
    with the zod messages and never call the model; WHEN `AI_API_KEY` is unset THE SYSTEM SHALL
    return 503 and never construct a partial client (the skeleton's `AiNotConfiguredError`
    path is never reached because the 503 guard precedes it).
- **US3** — As a **quality owner**, I want each generated endpoint to ship with an eval fixture,
  so that the deferred `ai-eval` gate (WS-5 part b) has something to score.
  - **AC-3.1** — THE SYSTEM SHALL emit `tests/ai-evals/<kebab>.eval.ts` exporting typed `cases`
    (a stable `AiEvalCase` shape: `name`, `input` matching the zod schema, and `asserts` of
    `contains` / `not-contains` / `llm-judge`). The fixture is **dormant** (no runner yet); it
    is documented as the contract the future `ai-eval` `/ship` gate consumes.

## Scenarios (Given/When/Then)
- **US1-happy** — Given a clean tree, When `--name Summarize --input text:string --writes any`,
  Then the four files are written under `ai/summarize` / `ai-summarize`, the route imports
  `runAgent`, and the blueprint stub carries `Scope: app/api/ai/summarize/**`.
- **US1-worst** — Given `app/api/ai/summarize/route.ts` already exists, When the generator runs,
  Then it exits non-zero naming that file and writes nothing.
- **US2-happy** — Given the emitted route, When `/ship` typechecks + lints it, Then it is green:
  auth+rate-limit compose correctly, zod guards the boundary, `withSpan` traces the call.
- **US2-worst** — Given `--writes admin`, When the route is emitted, Then it wraps
  `withAdminAuth` (ADMIN-only) and still keeps `withRateLimit` outermost.
- **US3-happy** — Given the emitted `.eval.ts`, When it is typechecked, Then `cases` conforms to
  `AiEvalCase[]` and imports nothing external (self-contained until the gate lands).

## Architecture sketch
- `scripts/scaffold-ai-endpoint.mjs` — Node generator (mirrors `scripts/scaffold-entity.mjs`:
  `parseArgs`, PascalCase validation, name helpers, idempotency guard, `--dry-run`, inline
  string templates, final "next steps" summary). No live route/UI in the template repo — like
  `/scaffold-entity`, it ships the generator, not a demo entity.
- Emitted per invocation (via `fs`, so the PreToolUse blueprint/build-vs-buy hooks — which only
  intercept Claude's Write/Edit tools — do not apply; the emitted **blueprint stub** is what
  keeps a later human edit of the route gate-clean):
  - `app/api/ai/<kebab>/route.ts` — the POST endpoint (AC-2.1).
  - `lib/validations/ai-<kebab>.ts` — zod input schema (lib/validations is hand-zod by design).
  - `tests/ai-evals/<kebab>.eval.ts` — typed eval fixtures (AC-3.1).
  - `docs/blueprints/ai-<kebab>.md` — a `Scope:`-bearing blueprint stub for the route.
- `.claude/skills/scaffold-ai-endpoint/SKILL.md`, `package.json` (`scaffold-ai-endpoint` script),
  `skill-rules.json` (auto-activation) — the harness wiring.

## The five pillars
- **Speed** — generated route short-circuits with 503 when unconfigured; single model round-trip;
  `withSpan` is a no-op when OTel is off.
- **Secure** — the generator BAKES the floor in (auth wrapper + zod + rate-limit-outside-auth +
  no direct SDK client); a scaffolded route cannot silently skip them.
- **Maintainable** — one generator owns the wiring; reuses `lib/ai`, `lib/observability`,
  `lib/api-helpers`, `lib/api-response`; no framework added.
- **Scalable** — rate-limit is mandatory and outermost; per-call model override still available
  via the `lib/ai` seam.
- **High-Quality** — honest 503/400 states; every endpoint born with an eval fixture; verified by
  generating a sample + typechecking the emitted output before the generator is called done.

## Tier
`shared` (enterprise pivot). The generator writes the security floor; nothing in it lowers it.

## Explicitly deferred (remaining WS-5 follow-on — ADR-036)
- `ai-eval` agent + the AI-eval `/ship` gate (Promptfoo / LLM-as-judge; ADR-020 pattern) that
  **runs** the `tests/ai-evals/*.eval.ts` fixtures this increment emits.
- The conditional 6th **AI-Quality** pillar (inert on non-AI forks).
- pgvector RAG substrate (`pgvector/pgvector:pg18`, ADR-035) + pluggable embeddings.
- Langfuse tracing wiring.
- An OpenAI-compatible provider path / cascade router (ADR-036 P2 migration trigger).

## Open questions
- [x] Does the generator ship a live demo endpoint? → **No** — mirrors `/scaffold-entity`
  (ships the generator, not a demo entity); a live `app/api/ai/*` route would be a per-fork
  choice, and a committed demo would need its own permanent blueprint + broaden the template
  surface. Verification uses a throwaway generated sample that is typechecked then removed.
- [x] Which auth default? → `--writes any` (`withAuth`) default; `editor`/`admin` opt-in. AI
  endpoints are authenticated-by-default (never public — a public model call is a cost/abuse
  vector), and rate-limited regardless.
