# Blueprint — Phase 7: Calibration Loop

> ARCHITECTURE.md §7 (the calibration loop — "build from day one"), §11
> (adverse-impact note), §12.7, §13 (honest limitations); UI-SPEC.md D.9
> (`/app/calibration` — outcome capture + calibration report + adverse-impact
> monitor). Builds on the Phase 6 `Result` (fitScore, `competencyScores` JSON,
> `roleProfileId`/`roleProfileVersion`, `decision`) and the immutable, versioned
> `RoleProfile`/`Competency` target profiles.

## Problem & outcome
The criterion bands are defensible from O*NET + the Big-Five literature on day
one, but they are **literature-based, not validated on Rihal's own population**
(ARCHITECTURE §13). Phase 7 bakes in the loop that turns "reasonable defaults"
into "validated against real hire outcomes": for each scored candidate we can
later attach an **outcome record** (hired / probation passed / 6- & 12-month
rating / retained); once a role profile version accumulates enough outcomes, an
admin can generate a **calibration report** that shows whether predicted fit and
each competency actually tracked observed success, and surfaces **advisory** band
adjustments. The loop is **advisory only** — a human reviews the suggestion and
creates a *new* role-profile version; the system **never auto-adjusts** a band
(ARCHITECTURE §7). An **adverse-impact monitor** sits alongside so band-driven
selection rates are visible before they create disparate impact (§11).

When this ships: an HR_ADMIN opens `/app/calibration`, records outcomes for
hired candidates, and — for role versions with enough data — sees a
predicted-fit-vs-observed-outcome report with per-competency predictive signal,
directional band suggestions, and a selection-rate monitor. Roles without enough
data show an honest "needs N more outcomes" state, never a fabricated chart.

## Market scan
- **Bryq / pymetrics / HireVue** — proprietary validation against *undisclosed*
  norms; the customer cannot inspect why a threshold moved. Our loop is the
  opposite: every calibration metric is computed by **pure, unit-tested code**
  over the org's own outcomes, the suggestion is **advisory + traceable**, and
  the adjustment is an explicit human-approved new version. This is the GCC-local
  validity edge ARCHITECTURE §7 calls out.
- **Stats math:** no new dependency. The metrics here (mean-fit split, simple
  correlation / point-biserial, 4/5ths selection-rate rule) are a few dozen lines
  of arithmetic — building them keeps them inspectable and citable, which is the
  whole defensibility thesis. A stats library would be a black box we'd have to
  justify to an auditor.
- **Charts:** `recharts` (already a dep) for the predicted-vs-observed scatter /
  bars and the selection-rate bars — adopt, mirror the Phase-6 `CompetencyRadar`
  token-fill pattern (dark + RTL follow CSS vars).

## Tier
`personal` (per `project.config.json`). The `/ship` blueprint gate only *warns*
at this tier, but Phase 7 touches the Ask-before surface (Prisma migration, new
API routes, `lib/`), so the full track is correct regardless. Security floor
unchanged: auth wrappers + zod on every route, tenancy by `orgId`, audit on, no
raw SQL, `/ship` green.

## User stories
- **As an HR_ADMIN, I want to record a candidate's post-hire outcome**, so that
  the org accumulates the data the calibration loop needs.
  - Acceptance: from `/app/calibration` (and, for a decided result, the candidate
    result page) I can attach hired (y/n), probation passed, 6-/12-month rating
    (1–5), and retained to a completed `Result`; the entry is `orgId`-scoped,
    zod-validated, audited, editable/correctable, and one-per-result.
- **As an HR_ADMIN, I want a calibration report for a role version with enough
  outcomes**, so that I can see whether fit and each competency predicted real
  success.
  - Acceptance: generating a report for a role version with ≥ the minimum
    outcomes produces (and persists) per-competency predictive signal, an
    overall predicted-fit-vs-observed-success summary, and **directional**
    (never auto-applied) band-adjustment suggestions, each labelled advisory with
    its sample size and a "directional, not statistically significant at this N"
    caveat.
- **As an HR_ADMIN, I want roles without enough data to say so honestly**, so
  that I'm never shown a fabricated or misleading calibration.
  - Acceptance: a role version below the minimum shows "needs N more outcomes"
    with the current count — no chart, no suggestion.
- **As an HR_ADMIN, I want a selection-rate / adverse-impact monitor**, so that
  band-driven disparate impact is visible.
  - Acceptance: selection (advance) and band-pass rates are shown per available
    group (role family / role profile) with the 4/5ths-rule flag; the panel
    states honestly that protected-class demographics are **not collected by
    design** (PDPL minimization), so this is a structural monitor, not an EEO
    study.
- **As a HIRING_MANAGER, I want NOT to be able to generate calibrations or change
  bands**, so that the maturity loop stays an admin governance surface.
  - Acceptance: report generation + adverse-impact reads are `withAdminAuth`;
    a manager session gets 403. (Outcome *capture* is `withManagerAuth` so the
    person who advanced the hire can record what happened.)

## Scenarios (per story)
- **Record outcome — Happy:** admin picks a hired candidate, enters probation
  passed + rating 4 + retained → 201, audited, shown on the result.
- **Record outcome — Worst:** rating 9 (out of 1–5) / rating on a non-hired
  candidate / a second outcome for the same result / a result in another org →
  zod 400 / domain 409 / unique-conflict 409 / 404 (tenant scope), never a 500
  or silent success.
- **Generate report — Happy:** role version with ≥ min outcomes → report persists
  to `ProfileCalibration`, renders charts + advisory suggestions.
- **Generate report — Worst:** role version with too few outcomes → typed
  `insufficient-data` (honest state, no write); a manager calling the route → 403;
  a role profile in another org → 404.
- **Band adjustment:** the report only *suggests*; there is **no** route that
  writes a band from a calibration. Applying a suggestion = the existing
  "new version" RoleProfile flow (out of Phase 7 scope), a deliberate human step.

## Architecture sketch
**Entities (new — Confidential, no new Restricted field → no `SCRUB_FIELDS`
change; add SECURITY.md §1 rows):**
- `OutcomeRecord` { id, orgId, resultId (unique → 1:1 with Result), hired Bool,
  probationPassed Bool?, rating6m Int?, rating12m Int?, retained Bool?,
  recordedById, recordedAt, deletedAt, deletedBy } `@@map("outcome_records")`.
  Soft-deletable (correctable operational record; register recycling). Audited
  automatically.
- `ProfileCalibration` { id, orgId, roleProfileId, version Int, metrics (Json),
  sampleSize Int, generatedById, generatedAt } `@@map("profile_calibrations")`.
  **Append-only history** of calibration runs per role-profile version (each
  generate creates a row → versioned audit trail; no soft-delete needed). Audited
  automatically. `metrics` JSON holds the full computed report (per-competency
  signal, fit summary, suggestions, selection rates) — same JSON-blob convention
  as `Result.competencyScores`.

**Pure math (`lib/calibration.ts` — NO I/O, mirrors `lib/scoring-rollup.ts`;
contract-tested in `tests/contracts/calibration.test.ts`):**
- `successScore(o: OutcomeInput): number | null` — collapse an outcome to a 0–1
  success signal (see "key decisions" — weighted: retained/probation/rating),
  `null` when too sparse to score.
- `correlate(pairs: {x,y}[]): number` — Pearson r over (predicted, observed)
  pairs; returns 0 for <2 pairs or zero variance (no NaN leaks).
- `competencySignal(rows): {name, r, meanPass, meanBelow, suggestion}[]` —
  per-competency correlation of competency score vs success + mean success of
  candidates who PASSed vs were BELOW the band → a directional suggestion
  (raise / lower / hold), each with sample size.
- `selectionRates(rows, groupBy): {group, selectionRate, passRate, n, flag}[]` —
  advance-rate + band-pass-rate per group, 4/5ths-rule flag.
- `buildCalibration(inputs): CalibrationReport` — orchestrates the above into the
  persisted `metrics` shape; the only thing the service calls.

**Service (`lib/services/calibration.ts`, `orgId`-scoped, paginated reads via
`lib/pagination.ts`):** `recordOutcome`, `getOutcomeForResult`, `listOutcomes`,
`generateCalibration` (loads the role version's results + outcomes via the
audited `prisma`, runs `buildCalibration`, persists `ProfileCalibration`, returns
typed `ok | insufficient-data | not-found`), `getLatestCalibration`,
`getAdverseImpact`. Reads = RSC via the service; no client fetch for reads.

**Routes (zod at the boundary, `withRateLimit` OUTSIDE the auth wrapper):**
- `POST /api/calibration/outcomes` — `withManagerAuth` (record/correct an outcome).
- `POST /api/calibration/[roleProfileId]/generate` — `withAdminAuth` (generate +
  persist a calibration report).
- Reads (outcome list, latest report, adverse-impact) are RSC through the
  service on the admin-gated `/app/calibration` page — no separate GET routes.

**State / no-duplication:** outcomes + calibrations are new tables; the report is
derived, not a duplicate of `Result`. The `/app/calibration` page is the existing
**Placeholder stub** (`app/[locale]/app/calibration/page.tsx`, nav already
registered admin-only in `components/layout/nav.ts`) — we replace the stub, not
add a route. Band *application* reuses the existing RoleProfile new-version flow
(Phase 3); we do not build a second profile-editing path. `docs/REPO-MAP.md`
confirms there is no existing calibration/outcome service.

**Migration:** `20260627140000_add_calibration` — sorts lexically AFTER
`20260627130000_add_result_and_decision` (monotonic; Prisma applies in lexical
order on the already-migrated Neon DB). Forward-only: adds two tables + FKs; drops
nothing.

## The five pillars
- **Speed:** reports are computed on explicit admin trigger and **persisted**
  (`ProfileCalibration`), so the page reads a cached row, not a recompute; outcome
  list is paginated/bounded.
- **Maintainable:** math is pure + unit-tested in one file, mirroring
  `scoring-rollup.ts`; the service reuses `prisma`, `pagination`, the auth
  wrappers, the recharts token pattern — no new primitives.
- **Scalable:** every read is `orgId`-scoped + bounded (`take`/`skip`); the
  generate route reads one role version's results (bounded by the role's
  candidates), no N+1, no full-table scan.
- **Secure:** `withManagerAuth`/`withAdminAuth` + zod on every route, tenancy by
  `orgId`, audit on (automatic for both new models); SJT keys / scores never
  leak; no protected-class data collected.
- **High-Quality:** the **insufficient-data honest state** is a first-class
  requirement, not an afterthought; suggestions are explicitly advisory with
  sample size + a small-N caveat; adverse-impact panel honestly states the
  demographic-data limitation; axe-clean, on-token, EN+AR/RTL + dark.

## Open questions (RESOLVED — defaults chosen per spec; flagged for operator review at gate-green)
Per the dev-only directive + the detailed spec (and `AskUserQuestion`'s known
flakiness in this env), these are resolved with documented, tunable defaults. All
are surfaced for the operator to adjust at the Phase-7 review pause.

- [x] **Success-signal definition** → a 0–1 weighted blend of the available
  outcome fields: `retained` (0.4) + `probationPassed` (0.3) +
  normalized mean of `rating6m`/`rating12m` (0.3); a non-hired candidate scores
  0; `null` if hired but no post-hire fields recorded yet. Single source in
  `successScore`, so it's trivially re-weighted. *Rationale:* retention is the
  strongest real-world signal; ratings are softer/subjective, so weighted but not
  dominant. **Tunable constant — operator may reweight.**
- [x] **Minimum outcomes for a report** → `MIN_OUTCOMES_FOR_REPORT = 8`,
  surfaced everywhere as **directional, not statistically significant** (true
  validation wants 30+; Rihal won't have that for a while — ARCHITECTURE §13).
  The honest state shows "needs N more". **Tunable.**
- [x] **Outcome-capture auth level** → `withManagerAuth` (the manager who
  advanced the hire records what happened); report generation + band suggestions
  are `withAdminAuth` (governance). Matches the task's dual-wrapper instruction
  and keeps the `/app/calibration` page admin-gated (existing nav).
- [x] **Adverse-impact grouping** → by role family / role profile (the only
  non-protected dimension we hold). Protected-class demographics are **not
  collected by design** (PDPL minimization), stated plainly in the panel; the
  monitor is a structural selection-rate view with the 4/5ths flag, not an EEO
  adverse-impact study. *This is the honest, defensible posture, not a gap.*
- [x] **Band suggestion never auto-applies** → there is no route that writes a
  band from a calibration; applying = the existing human new-version flow.
