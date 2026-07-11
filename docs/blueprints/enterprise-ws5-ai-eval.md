Scope: scripts/ai-eval.mjs, .claude/skills/ai-eval/**

# Blueprint — Enterprise WS-5 follow-on: the `ai-eval` LLM-as-judge gate

> Governs the SECOND follow-on increment on the shipped WS-5 AI skeleton
> (`docs/blueprints/enterprise-ws5-ai-layer.md`, ADR-036) — the part-b sibling of the
> `/scaffold-ai-endpoint` generator (`docs/blueprints/enterprise-ws5-followon.md`). The
> generator emits `tests/ai-evals/<kebab>.eval.ts` fixtures on every endpoint; this
> increment lands the runner that **executes and scores** them plus a fork-conditional
> `/ship` gate. It hand-writes no `app/api/**/route.ts` or `app/**/page.tsx` (the runner
> is a `scripts/*.mjs` Node process + a skill), so the blueprint-gate does not fire on it;
> this file is the requirements contract `/qa`/`/uat` trace against. Decision of record:
> **ADR-036** (the deferred "ai-eval gate + AI-Quality pillar" line). Build-vs-buy recorded
> in `docs/build-vs-buy-ledger.md` (2026-07-11 — AI eval runner).

## Problem & outcome
The WS-5 skeleton reaches the model, and `/scaffold-ai-endpoint` births every AI route
with a typed eval fixture — but nothing **runs** those fixtures, so an endpoint's output
quality is unmeasured. Deterministic tests (the contract suite) cannot assert "the summary
is faithful" or "the classifier stayed on task"; that needs eval scoring: substring checks
for hard invariants (no canned refusal, no leaked marker) and **LLM-as-judge** for the
soft "did it do the right thing?" question. Hand-run eval scripts rot and drift per fork.

This increment lands **`ai-eval`** — a runner (`scripts/ai-eval.mjs`) that discovers the
fixtures, POSTs each case to its endpoint, scores the completion (`contains` /
`not-contains` / `llm-judge` via `@/lib/ai`), and exits non-zero on any failure — wired
into `/ship` as a **fork-conditional** phase that mirrors the dormant `lhci` gate: inert
(exit 0) until a fork sets `AI_API_KEY`, writes fixtures, and runs the app, then a real
scored quality gate. The pristine template — no key, no fixtures — always skips green.

## Users & stories (EARS; worst path mandatory)
- **US1** — As a **developer**, I want one command to score my AI endpoints against their
  fixtures, so output quality is measured, not assumed.
  - **AC-1.1** — WHEN `npm run ai-eval` runs with `AI_API_KEY` set AND ≥1
    `tests/ai-evals/*.eval.ts` present THE SYSTEM SHALL POST each case's `input` to
    `${AI_EVAL_BASE_URL}/api/ai/<kebab>` (default `http://localhost:3000`), score every
    assert, print per-case PASS/FAIL, and exit non-zero iff any case fails.
  - **AC-1.2 (worst)** — WHEN `AI_API_KEY` is unset OR no fixtures exist THE SYSTEM SHALL
    print a `SKIP` note and exit 0 (dormant, like `lhci`/coverage) — never a false RED.
- **US2** — As a **quality owner**, I want an LLM-as-judge assert alongside substring
  checks, so soft quality ("faithful", "on task") is gradable, not just literals.
  - **AC-2.1** — `contains` SHALL require the substring (case-insensitive); `not-contains`
    SHALL forbid it; `llm-judge` SHALL grade the completion against its `rubric` **through
    `@/lib/ai` (`runAgent`)** — never a raw `new Anthropic(...)` — returning PASS/FAIL.
  - **AC-2.2 (worst)** — WHEN an endpoint returns non-2xx (incl. 401/403 for an
    auth-wrapped route) OR is unreachable (connection refused) THE SYSTEM SHALL count that
    case as FAILED with an actionable message (offer `AI_EVAL_AUTH`/`AI_EVAL_COOKIE` on
    401/403; name `AI_EVAL_BASE_URL` when unreachable), never a silent pass.
- **US3** — As a **release owner**, I want the gate wired into `/ship` without breaking the
  pristine template, so the security floor is unchanged and the gate self-activates per fork.
  - **AC-3.1** — `/ship` SHALL run `scripts/ai-eval.mjs` as a fork-conditional phase whose
    SKIP (exit 0) is a PASS, so `npm run ship` stays green in this repo (no AI key, no
    fixtures). The dormancy SHALL be recorded as an adjudicated-able wave-off in
    `docs/findings-register.md`, not dropped.

## Scenarios (Given/When/Then)
- **US1-happy** — Given `AI_API_KEY` set + `tests/ai-evals/summarize.eval.ts` + the app on
  `:3000`, When `npm run ai-eval`, Then each case POSTs to `/api/ai/summarize`, asserts
  score, and the run exits 0 iff all pass.
- **US1-worst / dormant** — Given no `AI_API_KEY` (this template), When `/ship` runs the
  phase, Then it prints SKIP and exits 0; `/ship` stays green.
- **US2-happy** — Given an `llm-judge` assert, When scored, Then the runner calls `runAgent`
  with the rubric + completion and reads a PASS/FAIL verdict.
- **US2-worst** — Given an auth-wrapped endpoint and no session, When a case POSTs, Then it
  fails with a 401/403 note pointing at `AI_EVAL_AUTH`/`AI_EVAL_COOKIE`.

## Architecture sketch
- `scripts/ai-eval.mjs` — Node runner. Dormancy check (`AI_API_KEY` + fixture discovery) →
  early exit 0; else register tsx's ESM loader programmatically (so the npm script stays a
  plain `node scripts/ai-eval.mjs`) to import the `.ts` fixtures and the `lib/ai` source;
  per fixture, map `<kebab>.eval.ts` → `POST /api/ai/<kebab>`, POST each case's `input`,
  read `{ data: { text } }`, score asserts, aggregate, exit 0/1. Reaches the model ONLY via
  `@/lib/ai` (`runAgent`) for the judge. Logs assert-level PASS/FAIL + short reasons only —
  never the key, raw prompts, or full completions (SECURITY.md §1).
- `scripts/ship.mjs` — a new fork-conditional phase-B step runs the runner; a 0 exit
  (skip or all-pass) is PASS, non-zero is RED. Absent-tool/absent-config degrades to a skip,
  never a false red (the ADR-020 dormancy pattern shared with `lhci`).
- `.claude/skills/ai-eval/SKILL.md` + `package.json` (`ai-eval` script) + `.env.example`
  (`AI_EVAL_BASE_URL`) + `docs/findings-register.md` (dormancy wave-off) — harness wiring.

## The five pillars
- **Speed** — one POST + at most one judge call per assert; the whole gate short-circuits to
  exit 0 when dormant, adding ~0s to `/ship` in the template.
- **Secure** — judge goes only through `@/lib/ai`; no key/PII logging; auth-wrapped routes
  stay auth-wrapped (the runner supplies a session, it does not bypass auth).
- **Maintainable** — reuses `lib/ai`, the scaffold's fixture contract, and the existing
  `--import tsx` convention; no framework, no new runtime dep.
- **Scalable** — fixtures are per-endpoint files; adding endpoints adds files, not runner
  changes; runs against local or a deployed `AI_EVAL_BASE_URL`.
- **High-Quality** — honest states (SKIP when dormant, FAIL on unreachable/401, never a
  green over a failure); the increment that makes output quality measurable at all.

## Tier
`shared` (enterprise pivot). The gate never lowers the floor; dormancy is recorded, not silent.

## Explicitly deferred (remaining WS-5 follow-on — ADR-036)
- The conditional 6th **AI-Quality** pillar surfaced in `docs/uat-rubric.md` (inert on
  non-AI forks) — this runner is its automatable slice; the rubric prose is the next step.
- A CI workflow (`ai-eval.yml`, dormant like `sast.yml`/`lhci`) that runs the gate against a
  preview URL on PRs once Actions billing unblocks (ADR-007/037 activation line).
- Promptfoo/keploy adoption re-evaluation if eval needs outgrow the in-house judge (ADR-036
  P2 migration trigger) — see the build-vs-buy ledger entry.
- pgvector RAG eval fixtures (retrieval-quality scoring) once the RAG substrate lands.

## Open questions
- [x] A new dep (Promptfoo) or in-house? → **in-house** — a ~200-line runner on the existing
  `lib/ai` + tsx + `fetch` beats a config-DSL dep that doesn't know this repo's auth wrappers
  or `{ data: { text } }` response shape. Re-evaluate at P2 (ledger entry).
- [x] How does the gate stay green in the pristine template? → **dormancy**: exit 0 when
  `AI_API_KEY` is unset OR no fixtures exist (the `lhci` pattern), recorded as a wave-off.
- [x] How are auth-wrapped endpoints reached? → optional `AI_EVAL_AUTH` (Authorization) /
  `AI_EVAL_COOKIE` (Cookie); the runner supplies a session, never bypasses the wrapper.
