# ADR-042 — AI-Quality: a conditional sixth pillar, inert on non-AI forks

**Status:** Accepted (enterprise pivot, WS-5 AI layer, operator-directed 2026-07-11)
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Builds on:** ADR-036 (the `lib/ai` agent stack + the `/ai-eval` LLM-as-judge gate)
and the Five Pillars (`docs/uat-rubric.md`; `CLAUDE.md` §Five Pillars) — the
existing gate-not-vibes quality contract this extends by one conditional pillar.

## Context

WS-5 landed an AI runtime (`lib/ai/*`, ADR-036): config-guarded, endpoint-agnostic,
silent-no-op until `AI_API_KEY` is set, with a `/scaffold-ai-endpoint` generator and
an `/ai-eval` gate that scores AI endpoints against fixtures (dormant → live once a
fork configures AI and writes fixtures). What WS-5 did **not** yet give the quality
system is a **pillar** — a named bar an AI endpoint is judged against, the way every
other change is judged against Speed / Secure / Maintainable / Scalable / High-Quality.

Two facts constrain the shape of that pillar:

- **AI failure modes are their own class.** A route that "returns 200 with text" can
  still be wrong in ways the five pillars don't name: it can be prompt-injected at the
  boundary, hallucinate a success over an empty completion, answer from model memory
  instead of retrieved context (ungrounded RAG), burn unbounded tokens, or leak
  Restricted input into a prompt or log. High-Quality gestures at "correctness"; none of
  the five names *these* checks as gates.
- **Most forks ship no AI at all.** The template is AI-off by default (`AI_API_KEY`
  unset, no `lib/ai` usage). A sixth pillar that fired on every fork would either be a
  dead checklist everyone waves off, or — worse — a `/ship`-RED on a repo with no AI
  surface to satisfy it. This very repo has no AI key; the pillar must not touch its
  green.

So the pillar must be **conditional**: a real gate where AI exists, and *nothing* —
no finding, no checklist item, no `/ship` effect — where it doesn't.

## Decision drivers

- AI endpoints have failure modes the five pillars don't name; leaving them to
  "High-Quality, use judgment" is exactly the vibes-not-gates failure the pillar system
  exists to prevent.
- The bar must be a **gate**, not advice — an automatable slice that `/ship` runs, plus a
  blocking checklist `/qa`/`/uat` must affirm, mirroring the other pillars' structure.
- It must be **inert on non-AI forks** — zero findings, zero `/ship` effect — reusing the
  established dormancy pattern so the default template stays green with no new config.
- It must **compose with, not duplicate,** the `/ai-eval` gate (ADR-036) and the ten
  ESLint rules that already hard-gate AI code.

## Considered options

### Option 1 — A conditional sixth pillar, AI-Quality (chosen)

Add **AI-Quality** as pillar 6 in `docs/uat-rubric.md` and `CLAUDE.md`, governing AI
endpoints only and **inert** on any fork with no `lib/ai` usage / no `AI_API_KEY`. It is
framed identically to the other pillars — an **automatable slice** (the `/ai-eval` gate +
the ten ESLint rules) and a **blocking checklist** (`/qa`/`/uat` affirm): eval pass-rate,
prompt-injection resistance at the boundary, honest AI failure states (503 when
unconfigured; no hallucinated success), grounding/citation for RAG, bounded cost/tokens,
and no Restricted/PII in prompts or logs. A concern not fixed is a wave-off in
`docs/findings-register.md`, adjudicated like any other pillar.

- Good: names the AI failure class as gates; reuses the exact pillar machinery
  (automatable + checklist + wave-off) reviewers already know; inert by construction on
  non-AI forks, so the default template is untouched.
- Bad: a sixth pillar is one more thing to hold in the rubric — mitigated by making it
  conditional, so on most forks it's simply absent.

### Option 2 — Fold AI checks into the existing five (rejected)

Spread the AI checks across Secure (injection, PII) and High-Quality (honest states,
grounding). Bad: no single owner for "is this AI output good?"; the checks scatter and
get lost, and there's no clean conditional switch — Secure and High-Quality apply to
every fork, so the AI items would read as dead noise on non-AI forks. Rejected — this is
the scatter the pillar system exists to prevent.

### Option 3 — A standalone `/ai-eval` gate with no pillar (rejected)

Keep only the ADR-036 eval gate; add no pillar. Bad: the eval runner covers pass-rate but
not injection resistance, honest failure states, grounding, cost bounds, or prompt/log
hygiene — the judgment calls a checklist owns. A gate without a pillar has no home for the
non-automatable half, so those checks stay vibes. Rejected in favor of a pillar that
*includes* the eval gate as its automatable slice.

## Decision

Adopt Option 1. AI-Quality becomes the **conditional sixth pillar**. It applies to a
fork's AI endpoints and is **inert everywhere else**. Its automatable slice is the
`/ai-eval` gate (ADR-036) plus the ten ESLint rules; its blocking checklist —
injection resistance, honest failure states, grounding, cost/token bounds, prompt/log
hygiene — is affirmed by `/qa`/`/uat`, with unfixed concerns adjudicated as wave-offs in
`docs/findings-register.md`. It lives beside the five in `docs/uat-rubric.md` (new pillar
entry + a new **Tier 2a — AI-Quality QA** subsection + a release-readiness line) and in
`CLAUDE.md`'s Five Pillars section, both flagged conditional.

## How it composes with the `/ai-eval` gate (ADR-036)

The pillar is the **why and the whole**; `/ai-eval` is the **automatable how** for one
slice of it. Precisely:

- **`/ai-eval` is the pillar's automatable eval-pass-rate check.** `scripts/ai-eval.mjs`
  scores `tests/ai-evals/*.eval.ts` fixtures against each `POST /api/ai/<kebab>` route
  (`contains` / `not-contains` / `llm-judge`). RED on any failing case; the pillar cites
  that RED as an AI-Quality failure.
- **The checklist owns what the eval runner can't express** — injection resistance
  (though it's *expressed* as `not-contains` eval cases), honest failure states,
  grounding, cost bounds, and prompt/log hygiene are judgment calls `/qa`/`/uat` affirm.
- **They share the same dormancy switch,** so they turn on together. Both are inert until
  `AI_API_KEY` is set AND fixtures/AI usage exist; both activate the moment a fork
  configures AI — no code change, just configuration.
- **No duplication:** the pillar does not re-implement scoring; it *points at* the
  `/ai-eval` gate for pass-rate and adds only the non-automatable checks around it.

## Why it stays inert on non-AI forks (and this repo stays green)

- **No `AI_API_KEY`, no AI usage → no surface to bind to.** The pillar governs "AI
  endpoints"; a fork with none has zero AI routes, so it raises zero AI-Quality findings
  and its Tier-2a subsection and release-readiness line are explicitly *skipped*.
- **The automatable slice is already dormant-by-design.** `/ai-eval` exits 0 (SKIP) until
  `AI_API_KEY` + fixtures exist (ADR-036); the ten ESLint rules only fire on code that
  imports `@/lib/ai` or logs secrets — a non-AI fork has neither. So `/ship` is
  byte-for-byte unaffected on this repo.
- **No new `/ship` phase, no new config default.** The pillar adds documentation and a
  QA-tier checklist; it introduces **no** new `scripts/ship.mjs` check — the automatable
  enforcement is entirely the existing (dormant) `/ai-eval` phase + the existing ESLint
  rules. There is nothing new to turn green.

The result mirrors `messages/ar.json` / RTL (ships inert until a fork opts in) and the
`lhci` / coverage / `ai-eval` dormant gates: present in the template, silent until
configured, a real gate the moment a fork turns AI on.

## Consequences

### Positive

- AI failure modes are named as **gates**, not left to "use judgment under High-Quality."
- Reuses the exact pillar machinery (automatable slice + blocking checklist + register
  wave-off) reviewers already know — no new mental model.
- Zero effect on non-AI forks and on this AI-off repo — `/ship` green is untouched.
- Composes cleanly with ADR-036: the eval gate is the pillar's automatable slice, not a
  parallel system.

### Negative

- A sixth pillar is one more item in the rubric — though absent on most forks by design.
- The blocking checklist is judgment-driven; like the other non-automatable pillar checks
  it depends on `/qa`/`/uat` actually affirming it, not skipping it.

### Mitigations

- The pillar is **conditional**: on a non-AI fork it is simply not present, so it adds no
  standing cost there.
- The register wave-off flow (`docs/findings-register.md`) is the same adjudication path
  as every other pillar — an un-affirmed AI-Quality concern blocks green exactly like a
  security wave-off, so it can't be silently dropped.

## Migration triggers

- If the automatable slice needs to grow beyond eval pass-rate + ESLint (e.g. a static
  cost/token-bound check, or an injection-corpus scan), add it as a **fork-conditional
  `/ship` phase** on the same dormancy pattern as `/ai-eval` — never a check that fires
  on non-AI forks.
- Revisit the checklist as AI surfaces broaden (tool-use agents, multi-turn, computer-use)
  — new failure classes get new checklist rows, not a new pillar.

## Related

- ADR-036 — the `lib/ai` agent stack + the `/ai-eval` gate (the pillar's automatable
  slice; this ADR names the pillar around it).
- `docs/uat-rubric.md` — the pillar entry, Tier-2a AI-Quality QA subsection, and
  release-readiness line.
- `CLAUDE.md` §Five Pillars — the conditional-sixth-pillar note.
- `docs/findings-register.md` — where an un-fixed AI-Quality concern is adjudicated.
- SECURITY.md §1 — Restricted data class (prompts/completions may carry it; log metadata
  only).
