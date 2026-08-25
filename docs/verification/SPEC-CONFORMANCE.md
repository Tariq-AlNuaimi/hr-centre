# Specification conformance report

**Source of truth:** `PMS_Functional_Specification_v1.0.docx` (14 sections + Appendix A), re-read
in full for this report — every clause below was checked against the code, not against memory.

**Repository:** `Tariq-AlNuaimi/rihal-performance-management` · **Date:** 2026-08-25

## The headline, stated plainly

**§1–§14 and Appendix A are built.** Every clause in the specification has an implementation, and
every load-bearing clause has a test that fails when the implementation is removed.

Two things this report does **not** claim:

- **It does not claim acceptance.** "Built" means implemented, tested and reviewed. No clause has
  been through user acceptance with the HR team who wrote the specification, and seven deliberate
  deviations (below) need Rihal's confirmation before this is anyone's system of record.
- **It does not claim the live deployment matches.** Verification ran against a local PostgreSQL
  built from the full migration chain. The Vercel deployment could not be confirmed from this
  container — see "Honest limitations".

## Evidence base

Every number below was produced by running the thing, on 2026-08-25.

| Measure                                                            | Value                                                                            |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Contract tests (`npm test`)                                        | **534 passing, 0 failing** across 33 files, plus 17 ESLint-rule tests            |
| DB-backed integration tests (real PostgreSQL, real route handlers) | **82 passing, 0 failing** — three consecutive concurrent runs                    |
| `npm run ship`                                                     | **green** — typecheck, lint, format, tests, build, gitleaks, npm audit, +14 more |
| Prisma models                                                      | 36                                                                               |
| Migrations applied from empty → current                            | 17, in order, on a database created for this report                              |
| API routes                                                         | 55                                                                               |
| Screens                                                            | 35                                                                               |
| Local ESLint security rules at `error`                             | 14                                                                               |
| ADRs                                                               | 67                                                                               |
| axe (WCAG 2.1 AA), Phase 3a + 3b screens, light/dark, en + ar      | **0 violations**                                                                 |
| i18n key parity (en ↔ ar)                                          | **exact** — 0 missing either way, asserted by a contract test                    |

Detailed evidence per phase: `docs/verification/pms-phase1/`, `pms-phase2/`, `pms-phase3a/`,
`pms-phase3b/`.

### How "verified" is earned

Three things had to be true before a row below says ✅:

1. **Something executes it.** A route, a screen, or a domain function that a route calls — not
   arithmetic sitting unused. The previous revision of this report used "computable, not wired" for
   §8 precisely because that distinction matters.
2. **A test pins it.** Named to the clause, so a future change that breaks the clause fails a test
   that says which clause.
3. **The test was mutation-tested where the claim is load-bearing.** Reverting the implementation
   must fail the test. A test that passes against a broken implementation is worse than no test,
   because it certifies. Mutations run for this report are listed in "Mutation log" below.

---

## §1 Overview

| Clause                                       | Status      | Evidence                                                                                                                                                   |
| -------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1.2 Three entities (Rihal, TP, CL)          | ✅ Verified | `OrgEntity` model; fixture seeds all three                                                                                                                 |
| §1.2 Employee → one department → one entity  | ✅ Verified | **Enforced by composite FK** `employees_department_entity_agree_fkey` — an employee in Rihal cannot point at a TP department. Not merely validated in code |
| §1.2 Departments unique to their entity      | ✅ Verified | `departments_id_entity_key`; fixture has "Sales" in two entities as distinct rows                                                                          |
| §1.2 C-Level tagged to entity, no department | ✅ Verified | `Employee.departmentId` nullable; import check allows blank department for `C_LEVEL` only                                                                  |
| §1.3 Exactly five role tracks                | ✅ Verified | `enum RoleTrack { C_LEVEL DIRECTOR MANAGER LEAD INDIVIDUAL }`                                                                                              |

## §2 Performance cycle cadence

| Clause                            | Status      | Evidence                                                                                                             |
| --------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| Annual cycle                      | ✅ Verified | `PerformanceCycle.year @unique`                                                                                      |
| Three touchpoints                 | ✅ Verified | `enum CycleStageKind { GOAL_SETTING MID_YEAR YEAR_END }`; `cycle_stages_cycle_id_kind_key` refuses a duplicate stage |
| HR sets each stage's deadline     | ✅ Verified | `PUT /api/cycles/[id]/stages`, HR-only                                                                               |
| Deadlines are hard locks          | ✅ Verified | `canActOnStage`; refusal verified one second past a deadline at all three stages                                     |
| Mid-year issues no scoring        | ✅ Verified | No mid-year path writes a `KpiRating`                                                                                |
| Scoring happens once, at year-end | ✅ Verified | `POST /api/scores` is the only writer of `EmployeeScore`, and it reads year-end ratings                              |

## §3 Org data & setup

| Clause                                                  | Status      | Evidence                                                                                                                                                       |
| ------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §3.1 Import as a LAYER into an internal table           | ✅ Verified | `lib/pms/import/` — `loaders/`, `validate.ts`, `reconcile.ts`, `run.ts`. Downstream reads `Employee`, never a file                                             |
| §3.2 Odoo ID as permanent stable key                    | ✅ Verified | `Employee.odooId @unique`; also the AAD binding salary ciphertext to its row (ADR-067)                                                                         |
| §3.3 **Twelve** required fields, incl. Date of Joining  | ✅ Verified | All twelve on `Employee` and in `IMPORT_COLUMNS`. _(A previous revision of this report marked this ✅ while Date of Joining was missing — see "Corrections".)_ |
| §3.4 Six validation rules, reject never silently accept | ✅ Verified | `lib/pms/import/checks/`; failures land in `ImportRowIssue`                                                                                                    |
| §3.5 New rows → create + enrol                          | ✅ Verified | `enrolParticipants` is idempotent                                                                                                                              |
| §3.5 Changed rows → update                              | ✅ Verified | `reconcile.ts`                                                                                                                                                 |
| §3.5 **Missing rows → change nothing**                  | ✅ Verified | `reconcile.ts` implements it explicitly; Appendix A's "silence is never destructive"                                                                           |

## §4 Roles, permissions & visibility

| Clause                                                   | Status      | Evidence                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §4.1 Five roles                                          | ✅ Verified | `enum PmsRole` + relationship-derived Employee/Line Manager                                                                                                                                                                                                   |
| §4.1 Strategy team has no system access                  | ✅ Verified | No role exists for them; HR keys their figures on `/admin/strategy-scores`                                                                                                                                                                                    |
| §4.2 Hierarchical visibility, however deep               | ✅ Verified | `descendantEmployeeIds` walks the full chain                                                                                                                                                                                                                  |
| §4.2 **Act on direct reports only; deeper is view-only** | ✅ Verified | `canActOnEmployee` vs `canViewEmployee`; §13.3's chain scope returns `readOnly: true` in the payload                                                                                                                                                          |
| §4.2 404 not 403 (no existence oracle)                   | ✅ Verified | Verified on every route; `/api/roll-ups` answers authority _before_ the read so it cannot leak which ids exist                                                                                                                                                |
| §4.3 Roles additive, "most access wins"                  | ✅ Verified | `capabilitiesFor` ORs; no hybrid roles exist                                                                                                                                                                                                                  |
| §4.4 My Tasks vs Oversight, by assignment                | ✅ Verified | `lib/pms/tasks.ts`, `components/pms/MyTasksOversight.tsx`                                                                                                                                                                                                     |
| §4.5 **Salary/bonus: HR, COO, Ops Director only**        | ✅ Verified | `canViewCompensation`; a dedicated ESLint rule (`no-restricted-export-column`) stops the column reaching a payload; §13.3's status payload asserted free of both. Salary is additionally **encrypted at rest** (AES-256-GCM, ADR-067) — beyond what §4.5 asks |

## §5 Goal-setting workflow

| Clause                                                                                   | Status      | Evidence                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| §5.1 The six-step sequence                                                               | ✅ Verified | Cycle → draft → review → both sign → HR approves                                                                                           |
| §5.1 **HR approval is the LOCK; sign-off is only agreement**                             | ✅ Verified | `goalsApprovedAt` gates edits; signatures do not                                                                                           |
| §5.2 Six authored texts per KPI                                                          | ✅ Verified | `kpis_texts_not_blank_check` refuses a blank descriptor                                                                                    |
| §5.3 **No reject button**                                                                | ✅ Verified | POST is the only verb on sign-off; no status, no DELETE                                                                                    |
| §5.3 Weightages total exactly 100 to sign                                                | ✅ Verified | One predicate shared by UI, route and approval; Decimal, not float. Applied **per period** on a §12.3 split year                           |
| §5.4 Hard locks; "Employee did not sign"                                                 | ✅ Verified | Verbatim status strings, rendered from `outstandingLabel`                                                                                  |
| §5.5 Ladder: reminders → **skip-level AND HR in parallel** → HR intervention after grace | ✅ Verified | `ComplianceKind` enum; the parallel step is asserted in one sweep. _(An earlier design had these sequential; corrected against the spec.)_ |
| §5.6 Compliance record: who, what, how late, what it took                                | ✅ Verified | `ComplianceEvent`, incl. `measuredAgainstDeadline` so an HR extension re-arms the ladder; surfaced by §13.5's manager compliance report    |

## §6 Mid-year review

| Clause                                                    | Status      | Evidence                                                                         |
| --------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------- |
| §6.1 Progress check, no scoring                           | ✅ Verified | Nothing on the mid-year path writes a rating                                     |
| §6.2 Manager submits a change request                     | ✅ Verified | `POST /api/kpi-change-requests`                                                  |
| §6.2 Full overhaul or partial change                      | ✅ Verified | Null = unchanged, end to end; only moved fields travel                           |
| §6.2 HR approves or rejects                               | ✅ Verified | `POST …/decide`, HR-only                                                         |
| §6.2 **Mandatory rejection reason the manager can see**   | ✅ Verified | Enforced at the boundary **and** by `kpi_change_requests_rejection_reason_check` |
| §6.3 Full version history, **archived never overwritten** | ✅ Verified | `KpiVersion` snapshots the superseded state; mutation-tested                     |

## §7 Year-end assessment

| Clause                                                         | Status      | Evidence                                                                                                                       |
| -------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| §7.1 Employee self-assesses using the goal-setting descriptors | ✅ Verified | The screen shows the **five sentences the manager authored**, never a bare 1–5                                                 |
| §7.1 Manager reviews                                           | ✅ Verified | Order enforced: a manager cannot rate an unassessed KPI                                                                        |
| §7.1 Both sign the final ratings                               | ✅ Verified | `POST /api/year-end-signoffs`; requires every KPI rated by both                                                                |
| §7.2 Manager-of-record resolved live                           | ✅ Verified | Read from `Employee.managerId` at the moment of action, never snapshotted — with §12.3's split as the one documented exception |

## §8 Scoring model

| Clause                                      | Status      | Evidence                                                                                                                                                               |
| ------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §8.1 1–5 scale                              | ✅ Verified | `kpi_ratings_level_range_check`                                                                                                                                        |
| §8.2 Rating × Weightage; bucket sums to 1–5 | ✅ Verified | `individualScore()`, tested against the spec's own example (0.15 + 0.80); called by `POST /api/scores`                                                                 |
| §8.3 Weight table by track                  | ✅ Verified | `TRACK_WEIGHTS` matches the table row for row; INDIVIDUAL's Departmental is `null`, not `0`, so a stray input errors rather than being silently zero-weighted          |
| §8.3 C-Level pass-through                   | ✅ Verified | Exempt from goal-setting/self-assessment everywhere; `finalScore` returns the entity score                                                                             |
| §8.4 Corporate/Departmental score entry     | ✅ Verified | `EntityScore` / `DepartmentScore` per cycle; `POST /api/strategy-scores`; screen at `/admin/strategy-scores`. Not-yet-keyed reads as "—", never as 0.00                |
| §8.5 360 ratio × 5                          | ✅ Verified | `threeSixtyAsLevel()` — the spec's 0.92 → 4.60; fed by §9's real assignments                                                                                           |
| §8.6 Final formula                          | ✅ Verified | `finalScore()` — the spec's Individual example → 3.96                                                                                                                  |
| §8.7 Band mapping                           | ✅ Verified | `bandFor()`, exact at every printed boundary; `BAND_RANGE` is the same table read the other way and is asserted to agree with `bandFor` at both ends of all five bands |

## §9 360 assessment module

| Clause                                             | Status      | Evidence                                                                                                               |
| -------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| §9.1 One 360 per performance year                  | ✅ Verified | `ThreeSixtyCycle.cycleId @unique`; a second is refused                                                                 |
| §9.2 One template per relationship direction       | ✅ Verified | `AssessmentType`; `templateTypeFor` decides from the RELATIONSHIP, so a peer form cannot be used on a manager          |
| §9.3 **4-point forced scale, no neutral midpoint** | ✅ Verified | `assignment_responses_score_range_check` constrains a scored answer to 1–4 in the database                             |
| §9.4 **Exactly 3 raters per employee**             | ✅ Verified | Checked at ACTIVATION, not per edit — §9.6 lets HR hold a half-built set on screen. Shortfalls are named, never padded |
| §9.4 HR manages all assignments                    | ✅ Verified | `PUT`/`POST /api/three-sixty/assignments`, HR-only; a rater sees only their own                                        |
| §9.5 Ratio = actual ÷ **that form's** maximum      | ✅ Verified | `formRatio` — the spec's 85/96, 84/84, 84/96 → 0.89/1.00/0.88 → 0.92 → 4.60                                            |
| §9.5 Open-ended answers never score                | ✅ Verified | `TemplateQuestion.scored` decides; a text answer contributes nothing                                                   |
| §9.6 Auto-generate, then HR edits before launch    | ✅ Verified | `proposeRaters` from the mapping; assignments are editable while the cycle is DRAFT                                    |
| §9.7 Activation, execution, results                | ✅ Verified | `POST /api/three-sixty/activate`, `…/responses`, `…/results`; console at `/three-sixty`                                |
| §8.3 No C-Level ratee; nobody rates themselves     | ✅ Verified | `assignments_no_self_rating_check` in the database, and asserted over the generated set                                |

## §10 Calibration

| Clause                                                | Status      | Evidence                                                                                                                                          |
| ----------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| §10.1 **Raw scores never overwritten**                | ✅ Verified | `EmployeeScore.rawScore` / `rawBand` are written once; calibration moves `calibratedBand` only. A re-run creates a NEW `ScoreRun`                 |
| §10.2 Editable target distribution                    | ✅ Verified | `CalibrationTarget`; `calibration_targets_total_check` refuses a curve that does not total 100                                                    |
| §10.3 Department-level curve, **≥5 editable minimum** | ✅ Verified | `minDepartmentSize` (default 5); a group below it gets `curveEligible: false` and **no gap** — null, not zero, because zero reads as "on target"  |
| §10.4 **Guided, not forced**                          | ✅ Verified | The screen shows target vs actual and the gap. There is no "apply the curve" button and `distributionGap` deliberately returns no suggested names |
| §10.5 **Mandatory reason on every override**          | ✅ Verified | Three layers: the button, the route, and `calibration_adjustments_reason_not_blank_check`                                                         |
| §10.6 **HRBP does not touch calibration**             | ✅ Verified | `canRunCalibration` is HR Super Admin only; asserted by an integration test that runs the route as an HRBP                                        |
| §10.7 Sequencing gate before release                  | ✅ Verified | `calibrationReadinessBlockedReason`, shared by the calibration read and the publish gate                                                          |

## §11 Bonus

| Clause                                                    | Status      | Evidence                                                                                                                  |
| --------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| §11.1 Bonus follows the final band                        | ✅ Verified | `BAND_COEFFICIENT`, matching the spec's table                                                                             |
| §11.2 Six-month eligibility gate                          | ✅ Verified | `isBonusEligible`, anchored on §3.3's Date of Joining                                                                     |
| §11.3 **Calibrated band, never the raw one**              | ✅ Verified | `computeBonus` reads `calibratedBand`; asserted by an integration test that moves a band and re-reads the bonus           |
| §11.4 Pro-ration on calendar days ÷ 365                   | ✅ Verified | `inclusiveDays`, `workDays`; joiner from Date of Joining, leaver to last working day                                      |
| §11.5 Unpaid leave reduces days **and** effective service | ✅ Verified | The spec's own example: 7 months − 2 unpaid → 5 effective → does not clear the gate                                       |
| §11.6 Confidentiality                                     | ✅ Verified | `canViewCompensation` on `/api/bonus` and on the executive dashboard's bonus total                                        |
| §11.7 **Payroll Excel export, HR-only, logged**           | ✅ Verified | `GET /api/bonus?format=xlsx`, real `.xlsx`, audited before the workbook is built. Columns in the clause's own order       |
| §11.7 Ineligible included **and flagged**                 | ✅ Verified | Every ineligible row carries its reason; an employee with no Date of Joining is flagged rather than computed from a guess |

## §12 Edge cases

| Clause                                                               | Status      | Evidence                                                                                                                                     |
| -------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| §12.1 Leaver status + last working day, by import **or manually**    | ✅ Verified | `POST /api/leavers`; last working day required, because §11.4 pro-rates to it                                                                |
| §12.1 Records preserved, never deleted                               | ✅ Verified | Asserted: after a departure `deletedAt` is still null and the row is intact                                                                  |
| §12.1 Absence from import never marks a leaver                       | ✅ Verified | §3.5's rule                                                                                                                                  |
| §12.1 **Pending actions close out** — no more reminders or "Overdue" | ✅ Verified | `isLadderExempt` skips leavers in the sweep. No switch to remember to flip: the close-out is a property of the status                        |
| §12.1 **360 assignments of a departed rater flagged to HR**          | ✅ Verified | Derived, never stored — a stored flag goes stale the moment HR reassigns, and import-recorded departures never pass through the manual route |
| §12.1 **Direct reports auto-roll-up ONE level**                      | ✅ Verified | To the departed manager's own manager, in the same transaction as the departure. Asserted, including the null-target case                    |
| §12.2 **HR prompt for temporary roll-ups**                           | ✅ Verified | `ManagerRollUp`; a partial unique index allows exactly one OPEN prompt per employee, asserted by a rejected insert                           |
| §12.2 New manager inherits signed KPIs; already-signed stays valid   | ✅ Verified | `managerChangeInvalidatesSignatures()` states it as a testable claim; resolving a roll-up touches no signature                               |
| §12.2 Manager-of-record = whoever currently holds the relationship   | ✅ Verified | The line MOVES on departure, so a sign-off is never owed to someone who has left                                                             |
| §12.3 **Mid-cycle transfer splits the year, day-weighted**           | ✅ Verified | `EmployeeAssignmentPeriod`; the spec's formula reproduced exactly, weights summing to 1.0000 over a full year                                |
| §12.3 Each department's manager owns their own portion               | ✅ Verified | The period snapshots its manager — the one place §7.2's live lookup gives the wrong answer in both directions                                |
| §12.3 Departmental **and** Corporate follow the periods              | ✅ Verified | `scoreSplitEmployee` day-weights all three components, then applies §8.6's track formula **once** to the weighted inputs                     |
| §12.3 360 done once at year-end, not duplicated                      | ✅ Verified | No 360 row is touched by a transfer                                                                                                          |
| §12.4 Probation handled normally                                     | ✅ Verified | By construction — no probation concept exists                                                                                                |

## §13 Outputs & reporting

| Clause                                                                                | Status      | Evidence                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §13.1 Scorecard shows band, score, 360 and combined comments                          | ✅ Verified | `GET /api/scorecard`; screen at `/scorecard`                                                                                                                                                                   |
| §13.1 **Never raw scores, components, or any sign of calibration**                    | ✅ Verified | Honoured by the SELECT, not by filtering: no component column is read. `displayScore` clamps the raw score into the awarded band so the two halves of the card cannot contradict each other (see Deviation 8)  |
| §13.1 Comments **not attributed to individual raters**                                | ✅ Verified | A flat, sorted list of strings — no rater, no assignment id, no per-form grouping. Sorting is part of the guarantee: submission order would leak who answered when                                             |
| §13.2 Hidden entirely until HR Super Admin publishes                                  | ✅ Verified | An unpublished cycle returns `{published:false}` with no score. Asserted                                                                                                                                       |
| §13.2 All-at-once, cycle-wide                                                         | ✅ Verified | One `CyclePublication` per cycle; there is no per-employee publish path                                                                                                                                        |
| §13.2 **Guarded: confirmation + warning + readiness check**                           | ✅ Verified | `confirm: z.literal("CONFIRM")` — a boolean would be satisfied by any truthy value a mis-wired client sends. Asserted against `true`, `"yes"`, `""` and absent                                                 |
| §13.2 Reversible, and the reversal audited (who, when, why)                           | ✅ Verified | Both directions audited; the reason is required on the way back                                                                                                                                                |
| §13.3 Manager workspace: status per stage, what is outstanding                        | ✅ Verified | `GET /api/status?scope=direct`; screen at `/team`. The outstanding count leads, because the clause calls this a cockpit "to self-manage BEFORE escalations fire"                                               |
| §13.3 Down-chain oversight, **view-only**                                             | ✅ Verified | `scope=chain` returns `readOnly: true` in the PAYLOAD, so the screen need not infer it from a role                                                                                                             |
| §13.3 **Status, scores and bands — never salary or bonus**                            | ✅ Verified | Asserted: the serialized payload contains neither string                                                                                                                                                       |
| §13.4 **One shared status engine, filtered by role**                                  | ✅ Verified | `lib/pms/status.ts` derives; `status-query.ts` reads for a caller-supplied id set. The filter lives in the route, never in the derivation, so §13.3, §13.5 and §13.6 cannot disagree about what "signed" means |
| §13.5 Cycle-progress / completion tracking                                            | ✅ Verified | `GET /api/reports/cycle-progress`, with per-department and per-entity breakdown                                                                                                                                |
| §13.5 Manager compliance report (§5.6)                                                | ✅ Verified | `GET /api/reports/manager-compliance`. Grouped BY MANAGER; an employee's own missed signature is recorded separately and never lands on anyone's record                                                        |
| §13.5 Results distribution, **also feeds calibration**                                | ✅ Verified | `GET /api/reports/results-distribution` reads the SAME `tally`/`distributionGap` the calibration screen does, so the report and the tool cannot disagree about the gap                                         |
| §13.5 Bonus report + Excel export                                                     | ✅ Verified | §11.7 above; the JSON view and the workbook are one dataset rendered twice, never two computations                                                                                                             |
| §13.5 Master results export — **HR Super Admin only, NOT HRBP**                       | ✅ Verified | A separate route on `canExportMasterResults`, because every other report here is open to org-wide sight (which includes HRBP). Asserted: an HRBP gets 403, a Super Admin does not                              |
| §13.5 Master export carries components, both scores, both bands, reasons, audit trail | ✅ Verified | Two-tab workbook. The audit tab is bounded and **says so** (`truncated`, `limit`, `scope`) rather than reading as complete                                                                                     |
| §13.6 Executive dashboard, aggregate-first                                            | ✅ Verified | `GET /api/reports/executive`; all four aggregates on one screen at `/executive`                                                                                                                                |
| §13.6 Full drill-down into any individual, including salary/bonus                     | ✅ Verified | Links to the existing per-employee surfaces, which enforce §4.5 for themselves — rather than a second place for that check to be got wrong                                                                     |
| §13.6 **Read-only throughout**                                                        | ✅ Verified | There is no POST on the route. A property of the API, not of a hidden button                                                                                                                                   |

## §14 Build approach

| Clause                                                             | Status      | Evidence                                                                                                                                           |
| ------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1: Excel import, no Odoo                                          | ✅ Verified |                                                                                                                                                    |
| v1: **Excel export for payroll**                                   | ✅ Verified | `lib/pms/export/xlsx.ts`; §11.7's workbook. Values are written as TEXT so a leading-zero employee id and a Decimal salary survive Excel's coercion |
| Import as a layer (v2-ready)                                       | ✅ Verified | A second loader drops into `loaders/`                                                                                                              |
| Odoo ID as stable key from day one                                 | ✅ Verified |                                                                                                                                                    |
| **Audit everything that changes a KPI, score or published result** | ✅ Verified | Prisma audit extension + explicit `recordAudit()` on every conditional update; mandatory reasons on rejection, calibration override and un-publish |

## Appendix A — Core system principles

| Invariant                                                                 | Status  | Where it lives                                                                                                                    |
| ------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Mirrors the manual process, no redesign                                   | ✅ Held | Every deviation is marked in code and listed below                                                                                |
| **HR approval locks; sign-off signals agreement**                         | ✅ Held | `goalsApprovedAt`                                                                                                                 |
| Responsibility falls on whoever controlled the action                     | ✅ Held | §5.5's ladder targets the manager; §13.5's compliance report excludes employees' own missed signatures from every manager's tally |
| **One owner per assessment**                                              | ✅ Held | `canActOnEmployee` — direct reports only; §12.3's period manager is the documented exception                                      |
| Roles additive, no hybrids                                                | ✅ Held | `capabilitiesFor`                                                                                                                 |
| Tasks by assignment, not hierarchy                                        | ✅ Held | `lib/pms/tasks.ts`                                                                                                                |
| **Raw scores never overwritten; calibration is a separate audited layer** | ✅ Held | `rawScore`/`rawBand` written once; `CalibrationAdjustment` is the layer, with §10.5's reason                                      |
| **Nothing visible until published; publish guarded and reversible**       | ✅ Held | §13.2's gate, four guards, both directions audited                                                                                |
| Audit everything sensitive, mandatory reasons                             | ✅ Held |                                                                                                                                   |
| Silence is never destructive                                              | ✅ Held | §3.5, verified                                                                                                                    |

---

## Mutation log

Every load-bearing test below was checked by breaking the implementation and confirming the test
fails. A test that passes against a broken implementation certifies nothing.

| Implementation broken                                     | Test that caught it                                        |
| --------------------------------------------------------- | ---------------------------------------------------------- |
| §12.3's transfer date moved into the OLD period           | day counts no longer sum to 365                            |
| `proratedComponent` tolerating an unassessed period       | a half-assessed employee scored                            |
| `displayScore` dropping the upper clamp                   | a moved band showed a contradicting score                  |
| §5.4's two status strings swapped                         | "Employee did not sign" appeared for a manager's miss      |
| `NOT_APPLICABLE` counted in the completion denominator    | C-Level participants dragged the percentage                |
| `?? employee.managerId` restored on a transfer's period 2 | an explicit null manager recorded the old one              |
| Authority checked after the read on `/api/roll-ups`       | 404 vs 403 distinguished a real roll-up id from a fake one |
| §6.3's archive direction reversed                         | the version history held the new state, not the superseded |
| The partial index on pending change requests removed      | a second pending request was accepted                      |
| §5.3's exactly-100 guard loosened                         | a 99.99% set scored                                        |
| INDIVIDUAL's Departmental weight set to 0 instead of null | a stray Departmental input was silently zero-weighted      |
| §8.7's band thresholds changed from `>=` to `>`           | 4.50 fell out of Outstanding                               |

## Corrections to previous revisions of this report

Stated explicitly, because a conformance report that quietly revises itself is worth less than none.

1. **§3.3 was marked ✅ while Date of Joining was not implemented.** The row said "eleven required
   fields"; §3.3 lists twelve. A contract test asserting "all 11 columns" was itself encoding the
   omission. Both are fixed, and the field is now the anchor for §11.2 and §11.4.
2. **§8 was marked "computable, not wired" and is now wired.** That earlier status was accurate and
   is retained in this note so the change is visible rather than silent.
3. **The fixture could not be seeded.** Running the seed against the real schema for this report
   surfaced a mid-year joining date hard-coded a year and a week into the future, which the
   date-of-joining sanity CHECK rejects — so `prisma db seed` failed outright. Joining dates are
   now offsets from the seed's own clock.
4. **The integration suites were structurally flaky.** Four suites raced to log in as the one
   seeded HR Super Admin through a UNIQUE column while node ran the files concurrently; the loser
   failed with a 403 that looked like a permissions bug. Each suite now owns the employees it
   mutates. Three consecutive full concurrent runs: 82 pass, 0 fail.

## Deviations from the specification — all deliberate, all marked in code

Nothing was changed silently. Each of these is either a gap the spec leaves or a decision the
operator made, and each is flagged in the code where it applies.

| #   | Where | What the spec says                            | What was built, and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | §6.2  | "if a KPI needs adjusting" — singular         | A request carries **several** edits, decided as a unit, refused off 100%. §5.3 requires exactly 100 and mid-year has no sign-off to catch a violation, so one-KPI requests would leave an approved baseline at 90% for months                                                                                                                                                                                                                                                                                            |
| 2   | §6.2  | Silent on re-signing after an approved change | **No re-sign invented.** `SignOff.kpiSetHash` surfaces that a signature predates the current set. **Open question for Rihal**                                                                                                                                                                                                                                                                                                                                                                                            |
| 3   | §7.1  | "manager reviews"                             | The manager **sees** the self-assessment while rating. Literal reading; the cost is anchoring                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 4   | §7.1  | Silent on justifying a divergent rating       | A divergent manager rating **requires a reason**, in either direction. **Addition — for Rihal to confirm**                                                                                                                                                                                                                                                                                                                                                                                                               |
| 5   | §8.7  | Bands printed as 4.00–4.49 and 4.50–5.00      | 4.495 belongs to no band as written. Implemented as `>=` thresholds. **For Rihal to confirm**, along with whether scores are rounded before banding                                                                                                                                                                                                                                                                                                                                                                      |
| 6   | §4.5  | Salary "visible only to…"                     | Also **encrypted at rest** (AES-256-GCM bound to `odooId`). Stronger than asked                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 7   | §5.5  | —                                             | An HR deadline extension **re-arms** the ladder (`measuredAgainstDeadline`). Without it the compliance log went silent after an extension                                                                                                                                                                                                                                                                                                                                                                                |
| 8   | §13.1 | "final band and score (calibrated…)"          | §10 moves BANDS, not scores, and §10.1 forbids overwriting the raw one — so there is no stored calibrated score. The displayed score is the raw score **clamped into the awarded band's §8.7 range**: an uncalibrated employee sees their exact score, a calibrated one sees a score that agrees with their band, and the raw figure survives in the column §13.5's master export reads. Showing the raw score unclamped beside a moved band is itself the "sign of calibration" §13.1 forbids. **For Rihal to confirm** |
| 9   | §12.3 | "a second mid-cycle transfer"                 | Not addressed by the spec, and **refused** in v1 rather than half-applied: three periods need a re-split of an already-split set and a decision about which period the middle KPIs belong to. The refusal names itself                                                                                                                                                                                                                                                                                                   |
| 10  | §13.5 | "full audit trail"                            | `audit_logs` rows carry an entity id, not a cycle, so the master export's trail spans all cycles rather than only the exported one. Stated in the payload. An over-inclusive trail is the safer failure — an under-inclusive one is the failure nobody notices                                                                                                                                                                                                                                                           |

## Honest limitations of this report

- **Verification ran against a local PostgreSQL fixture** (36 seeded employees), built from the
  full 17-migration chain, not against production data.
- **The live deployment could not be confirmed from the build container.** `vercel.json` runs
  `prisma migrate deploy` before `next build`, so a failed migration fails the build and the prior
  deployment keeps serving — but that is reasoning, not evidence. Confirm on the Vercel dashboard.
- **Browser and axe evidence covers Phases 1–3b.** The Phase 4–6 screens are typechecked, linted,
  built and served by tested routes, but have not had a browser pass or an axe run. That is the
  next verification step, not a claim made here.
- **"Verified" means implemented, tested and reviewed — not accepted by Rihal.** No clause here has
  been through user acceptance with the HR team who wrote the specification, and the ten deviations
  above include four explicit open questions for them.
