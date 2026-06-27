# Blueprint — Phase 6: Results, Dashboards & AI Role 2

> ARCHITECTURE.md §6 (scoring engine), §4 (AI Role 2), §12.6; UI-SPEC.md D.1
> (dashboard), D.6 (results list), D.7 (single result — the signature
> "evidence trail"), D.8 (compare). Builds on the Phase 1–5 foundation
> (Assessment / ItemResponse / SjtResponse capture, RoleProfile/Competency
> target profiles, the `lib/scoring.ts` + `lib/llm.ts` seams).

## Problem & outcome
Candidates have completed assessments (Phase 4) but managers have **nowhere to
see a result**. Phase 6 turns captured responses into a **decomposed, source-
traceable result**: a fit-to-role score that visibly breaks down into
competencies → traits → O*NET/literature sources, plus a numbers-bound AI
narrative and a recorded hire decision. When this ships, an HR_ADMIN or
HIRING_MANAGER can open a completed candidate, understand *why* the fit score is
what it is, compare candidates for one role, export a branded PDF, and record an
Advance/Hold/Decline decision — all tenant-scoped and audited. This is the
product's signature surface (UI-SPEC: "the whole point is decomposition, not a
verdict").

## Market scan
- **Bryq / HireVue / pymetrics** — proprietary AI infers a fit score against
  *undisclosed* norms; you cannot inspect *why* a trait was weighted. Our
  differentiator (ARCHITECTURE §2) is the opposite: every number traces to O*NET
  importance + a cited Big-Five finding, rendered as the visible evidence trail.
  We build the decomposition UI they deliberately hide.
- **Charts:** `recharts` (already a dep) for the radar (competency vs target) and
  horizontal percentile bars — adopt, don't build a charting engine.
- **PDF:** `@react-pdf/renderer` (operator-approved, this blueprint) — renders in
  Node **without a headless browser**, so it sidesteps the serverless-PDF
  landmine CLAUDE.md calls out (pdfkit/Puppeteer fragile on Vercel; PDF was
  intentionally absent from `lib/export.ts`). We build only the branded template.
- **Tables:** the shipped shadcn `Table` primitive (Phase 5 precedent) — no
  TanStack dep; our grids are static/server-sorted, not client-virtualized.
- **Scoring math:** the deterministic roll-up (steps 3–6 below) is ours to
  build + unit-test; the raw→facet/percentile step stays in the Python
  `services/scoring` service (don't re-transcribe IPIP keys — ARCHITECTURE §3/§6).

## Tier
`personal` (per `project.config.json`). The `/ship` blueprint gate only *warns*
at this tier, but Phase 6 touches the Ask-before surface (Prisma migration, new
API routes, `lib/`, a >50KB dep), so the full track is correct regardless. The
security floor is unchanged: auth wrappers + zod on every route, tenancy by
`orgId`, audit on, no raw SQL, `/ship` green.

## User stories
- **As a HIRING_MANAGER, I want to see a candidate's decomposed result**, so that
  I can judge fit on evidence rather than a black-box number.
  - Acceptance: `/app/candidates/[id]` shows the fit score (band-colored ring),
    a competency radar vs target, per-competency PASS/PARTIAL/BELOW with the
    mapped facets + source citation, Big-Five facet percentile bars, and SJT
    judgement — every number reachable to its source in ≤2 clicks.
- **As a HIRING_MANAGER, I want a plain-language summary of the numbers**, so that
  I can read the result quickly.
  - Acceptance: an "AI summary of the results above" paragraph appears *when the
    LLM is configured*, restating only computed numbers, with **no** hire/no-hire
    recommendation; when the LLM is unconfigured the numbers still render with a
    calm "summary not available" note (never a broken/empty panel).
- **As a HIRING_MANAGER, I want to record a decision**, so that the human call is
  captured and audited.
  - Acceptance: an Advance/Hold/Decline control + optional note persists to the
    `Result`, is written to the audit log (actor + timestamp), and renders as a
    decision pill in the candidates list. The tool never auto-decides.
- **As a HIRING_MANAGER, I want to compare candidates for one role**, so that I can
  choose between shortlisted people on the same axes.
  - Acceptance: `/app/compare?role=&ids=` shows 2–6 candidates as columns,
    competencies/fit as band-colored rows, single-role-only (cross-role rejected).
- **As a HIRING_MANAGER, I want to export a branded result PDF**, so that I can
  share it offline / attach it to a hiring file.
  - Acceptance: `GET /api/results/[id]/pdf` streams a Rihal-branded PDF (fit +
    decomposition + methodology footer + provenance), tenant-scoped.
- **As an HR_ADMIN, I want a dashboard pipeline snapshot**, so that I can see the
  funnel and what's awaiting review at a glance.
  - Acceptance: `/app/dashboard` tiles (invited / started / completed / awaiting
    review) show **real** tenant-scoped counts and are clickable into filtered
    lists; "awaiting your review" + "active roles" render real data or honest
    empties.

## Scenarios (per story)
- **Result view — Happy:** completed assessment, scoring + LLM configured →
  Result computed lazily on first view, persisted, full decomposition + narrative.
- **Result view — Worst:**
  - assessment **not yet completed** → no fit score; partial state clearly marked,
    no compute attempt.
  - scoring service **unconfigured/unreachable** → calm "scoring not configured /
    couldn't reach scorer" state with a retry, **no** persisted partial Result,
    no 500.
  - wrong-tenant `id` → 404 (not a cross-tenant disclosure), never the row.
  - HIRING_MANAGER requests the **SJT scoring key** → masked server-side (only the
    candidate's correctness shows, never the key).
- **Decision — Happy:** valid `{decision, note}` → persisted + audited + pill updates.
- **Decision — Worst:** invalid enum / note over max length → zod 400 message, no
  write; decision on an **in-progress** assessment → 409 (nothing to decide yet);
  double-submit → idempotent overwrite of the single current decision (history in
  audit), not a duplicate.
- **Compare — Worst:** <2 ids → "select at least two"; >6 → capped with a notice;
  ids spanning two roles → rejected ("compare within one role").
- **PDF — Worst:** result not yet computed → 409 "compute the result first";
  wrong tenant → 404.
- **Narrative — Worst:** LLM returns off-schema / a recommendation → schema
  validation rejects; narrative omitted, numbers still shown.

## Architecture sketch

### Entities + key fields (migration `add_result_and_decision`)
- **`Result`** (audited, soft-deletable; one per assessment) — **Confidential**
  (candidate behavioral data; SECURITY.md §1):
  - `id`, `orgId`, `assessmentId @unique`
  - `roleProfileId`, `roleProfileVersion` (snapshot — results stay interpretable
    after the profile versions, ARCHITECTURE §5)
  - `facetScores` Json (30 facets: raw + percentile), `domainScores` Json (5),
    `sjtScores` Json (per-competency SJT sub-scores), `competencyScores` Json
    (per competency: score 0–100, band, the driving facets, citation)
  - `fitScore` Int (0–100), `communityPercentile` Int?
  - `scoringModel` String (e.g. "IPIP-NEO-120"), `computedAt` DateTime
  - `narrative` String?, `narrativeModel` String?, `narrativeAt` DateTime?
  - `decision` `DecisionOutcome?`, `decisionNote` String?, `decidedById` String?,
    `decidedAt` DateTime?
  - soft-delete (`deletedAt`/`deletedBy`) + timestamps, `@@index([orgId])`,
    `@@index([roleProfileId])`
- **`DecisionOutcome`** enum: `ADVANCE | HOLD | DECLINE`.
- *Out of scope (Phase 7 calibration):* `OutcomeRecord`, `ProfileCalibration`.

### Scoring roll-up (deterministic — ARCHITECTURE §6; the value-add)
`lib/scoring-rollup.ts` — **pure, unit-tested** functions (no I/O):
1–2. raw→facet/domain + **percentiles**: from `lib/scoring.requestScoring()` (the
   Python service). Input = the 120 `ItemResponse`s as `{itemNumber, response}`.
3. **SJT**: per `SjtResponse`, compare `chosenOptionId` to `SjtItem.scoringKey`
   (server-side; key never leaves the server) → per-competency sub-score.
4. **Competency roll-up**: `facetContribution(percentile, direction)` —
   `HIGH`→`percentile`, `LOW`→`100−percentile`, `MODERATE`→`max(0,100−2·|p−target|)`;
   competency score = weighted mean of its mapped facet contributions, blended
   with the SJT sub-score when present.
5. **Band**: `PASS` if score ≥ `targetPercentile`; `PARTIAL` if ≥ target−15; else
   `BELOW`.
6. **Fit**: weighted mean of competency scores by `weight` → 0–100.
   Formulas documented in code + (Phase 8) the methodology page.
`lib/services/result.ts` orchestrates: load assessment+responses+active profile →
call scorer → roll up → persist `Result` (create; on unique race re-read). Gated
by `isScoringConfigured()`; returns a typed "not configured / unreachable" result
otherwise (no partial write).

### AI Role 2 — narrative (ARCHITECTURE §4; mirrors `draftRoleProfile`)
`lib/llm.draftResultNarrative(input)` — input is **computed numbers only** (fit,
per-competency band+score, domain/facet percentiles, SJT); **no JD, no candidate
name/email**. Output schema-validated `{ narrative }`, low temp, prompt forbids
any judgement not in the numbers and any hire/no-hire. Dormant + graceful when
`isLlmConfigured()` is false. Cached in `Result.narrative`.

### Routes (auth wrapper + tenancy `orgId`; `withRateLimit` OUTSIDE)
- `POST /api/results/[assessmentId]/compute` — `withManagerAuth`; lazy compute +
  persist + recompute. (RSC page auto-triggers on first view when configured.)
- `POST /api/results/[id]/narrative` — `withManagerAuth`; generate/regenerate AI
  narrative.
- `POST /api/results/[id]/decision` — `withManagerAuth`; zod `{decision, note?}`.
- `GET  /api/results/[id]/pdf` — `withManagerAuth`; streams the branded PDF.
- Reads (candidates list, single result, compare, dashboard) are **RSC via
  services** (`lib/services/result.ts`, Phase-5 precedent), `orgId`-scoped,
  bounded/paginated. SJT keys masked in every read.

### UI (shadcn + recharts; on-token, RTL `ar`, dark, axe-clean — `/design-system`)
- `/app/dashboard` — wire the existing shell's tiles + tables to real counts.
- `/app/candidates` (replaces placeholder) — list: candidate, role, fit mini-bar,
  status, completed, decision pill; filter by role/decision; bulk-select→compare.
- `/app/candidates/[id]` (replaces placeholder) — the evidence trail: fit ring,
  radar, competency breakdown (band pills + drivers + citation), Big-Five bars,
  SJT, AI narrative (labelled), decision block, Export PDF. Gold `--rihal-sand`
  rationed to the fit→competency→source connectors.
- `/app/compare` (replaces placeholder) — band-colored grid, single role, cap 6.
- i18n `results` + `candidates` namespaces in `messages/en.json` + `ar.json`.

### Anti-duplication check
No Result/decision surface exists today — `app/[locale]/app/candidates/` and
`compare/` are `<Placeholder>` stubs; nav entries already point at them
(`components/layout/nav.ts`). The dashboard shell exists (`app/[locale]/app/
page.tsx`) with hard-coded `0` tiles — Phase 6 wires real data, not a second
dashboard. Scoring/LLM reuse the existing `lib/scoring.ts` / `lib/llm.ts` seams
(no new client). PDF is the one genuinely new capability (new dep + `lib/pdf/`).

## The five pillars
- **Speed:** RSC reads; result computed once and **persisted** (not recomputed per
  view); charts render client-side from a bounded payload; lists paginate.
- **Maintainable:** roll-up is pure + unit-tested; reuses scoring/LLM seams +
  shadcn/recharts primitives; `roleProfileVersion` snapshot keeps old results
  readable; forward-only migration (adds a table + enum, drops nothing).
- **Scalable:** candidates/compare lists bounded + `orgId`-indexed; no N+1 (batch
  the role/decider lookups, Phase-5 pattern); compare capped at 6.
- **Secure:** `withManagerAuth` + `orgId` on every route/read; SJT `scoringKey`
  masked server-side; AI narrative gets **no** PII; Result is Confidential (audit
  before/after inherit the label, no new Restricted field → no `SCRUB_FIELDS`
  change); zod at every boundary; decision change audited.
- **High-Quality:** honest in-progress / not-configured / unreachable / scoring-
  error states (never a green panel over a failure); axe-clean radar/bars (named
  series, non-color-only bands); RTL mirrors the grid + charts; the AI summary is
  explicitly labelled and never a recommendation.

## Open questions  (resolved via AskUserQuestion, 2026-06-27)
- [x] PDF export approach → **`@react-pdf/renderer`** (serverless-safe, branded
  template; operator-approved >50KB Ask-before dep).
- [x] Phase 6 scope this session → **Full Phase 6** (results + decomposition +
  narrative + decision + candidates list + compare + PDF + dashboard wiring),
  then pause for operator review before Phase 7.
- [x] Scoring trigger → **lazy compute on first view + persist** a `Result` row,
  with a recompute action; resilient to a submit-time scoring outage.
- [x] Decision persistence shape (operator deferred to architecture) → **fields on
  `Result`** (single current decision); change-history lives in the audit log.
- [x] Tables → **shadcn `Table`** (no TanStack dep), per Phase-5 precedent.
- [x] `/methodology` page → **Phase 8** (compliance); Phase-6 result links to it
  and shows provenance inline; a minimal stub avoids a dead link.
