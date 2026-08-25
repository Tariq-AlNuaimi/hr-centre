# Specification conformance report

**Source of truth:** `PMS_Functional_Specification_v1.0.docx` (14 sections + Appendix A), re-read
in full for this report — every clause below was checked against the code, not against memory.

**Repository:** `Tariq-AlNuaimi/rihal-performance-management` · **Date:** 2026-08-25

## The headline, stated plainly

**§1–§7 are built and verified. §8 is built as computation but nothing calls it yet. §9–§13 are
not built.**

This report does not claim the specification is fully implemented, because it is not. Roughly half
the specification by section count is live; the half that remains — the 360 module, calibration,
bonus, and reporting — is the half that turns assessments into published results and money.

## Evidence base

Every number below was produced by running the thing, on 2026-08-25.

| Measure                                                            | Value                                                                            |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Contract tests (`npm test`)                                        | **470 passing, 0 failing** across 30 files                                       |
| DB-backed integration tests (real PostgreSQL, real route handlers) | **32 passing, 0 failing**                                                        |
| `npm run ship`                                                     | **green** — typecheck, lint, format, tests, build, gitleaks, npm audit, +14 more |
| Prisma models                                                      | 20                                                                               |
| Migrations applied from empty → current                            | 14, in order                                                                     |
| API routes                                                         | 35                                                                               |
| Screens                                                            | 26                                                                               |
| Local ESLint security rules at `error`                             | 14                                                                               |
| ADRs                                                               | 68                                                                               |
| axe (WCAG 2.1 AA), Phase 3a + 3b screens, light/dark, en + ar      | **0 violations**                                                                 |

Detailed evidence per phase: `docs/verification/pms-phase1/`, `pms-phase2/`, `pms-phase3a/`,
`pms-phase3b/`.

---

## §1 Overview

| Clause                                       | Status   | Evidence                                                                                                                                                                                           |
| -------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1.2 Three entities (Rihal, TP, CL)          | ✅ Built | `OrgEntity` model; fixture seeds all three                                                                                                                                                         |
| §1.2 Employee → one department → one entity  | ✅ Built | **Enforced by composite FK** `employees_department_entity_agree_fkey` (`20260824120000_…/migration.sql:219`) — an employee in Rihal cannot point at a TP department. Not merely validated in code. |
| §1.2 Departments unique to their entity      | ✅ Built | `departments_id_entity_key`; fixture has "Sales" in two entities as distinct rows                                                                                                                  |
| §1.2 C-Level tagged to entity, no department | ✅ Built | `Employee.departmentId` nullable; import check allows blank department for `C_LEVEL` only                                                                                                          |
| §1.3 Exactly five role tracks                | ✅ Built | `enum RoleTrack { C_LEVEL DIRECTOR MANAGER LEAD INDIVIDUAL }`                                                                                                                                      |

## §2 Performance cycle cadence

| Clause                            | Status     | Evidence                                                                                                             |
| --------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| Annual cycle                      | ✅ Built   | `PerformanceCycle.year @unique`                                                                                      |
| Three touchpoints                 | ✅ Built   | `enum CycleStageKind { GOAL_SETTING MID_YEAR YEAR_END }`; `cycle_stages_cycle_id_kind_key` refuses a duplicate stage |
| HR sets each stage's deadline     | ✅ Built   | `PUT /api/cycles/[id]/stages`, HR-only                                                                               |
| Deadlines are hard locks          | ✅ Built   | `canActOnStage` (`lib/pms/cycle.ts`); refusal verified at all three stages                                           |
| Mid-year issues no scoring        | ✅ Built   | No mid-year path writes a `KpiRating`; asserted as US-21                                                             |
| Scoring happens once, at year-end | ⚠️ Partial | §8's arithmetic exists (`lib/pms/scoring.ts`) but no route computes or stores a score                                |

## §3 Org data & setup

| Clause                                                  | Status   | Evidence                                                                                                           |
| ------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| §3.1 Import as a LAYER into an internal table           | ✅ Built | `lib/pms/import/` — `loaders/`, `validate.ts`, `reconcile.ts`, `run.ts`. Downstream reads `Employee`, never a file |
| §3.2 Odoo ID as permanent stable key                    | ✅ Built | `Employee.odooId @unique`; also the AAD binding salary ciphertext to its row (ADR-067)                             |
| §3.3 Eleven required fields                             | ✅ Built | All present on `Employee`                                                                                          |
| §3.4 Six validation rules, reject never silently accept | ✅ Built | `lib/pms/import/checks/`; failures land in `ImportRowIssue`                                                        |
| §3.5 New rows → create + enrol                          | ✅ Built | `enrolParticipants` is idempotent                                                                                  |
| §3.5 Changed rows → update                              | ✅ Built | `reconcile.ts`                                                                                                     |
| §3.5 **Missing rows → change nothing**                  | ✅ Built | `reconcile.ts:17` implements it explicitly; Appendix A's "silence is never destructive"                            |

## §4 Roles, permissions & visibility

| Clause                                                   | Status   | Evidence                                                                                                                                                                                                        |
| -------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §4.1 Five roles                                          | ✅ Built | `enum PmsRole` + relationship-derived Employee/Line Manager                                                                                                                                                     |
| §4.1 Strategy team has no system access                  | ✅ Built | No role exists for them — HR keys their scores (the entry screen is §8.4, not built)                                                                                                                            |
| §4.2 Hierarchical visibility, however deep               | ✅ Built | `descendantEmployeeIds` walks the full chain                                                                                                                                                                    |
| §4.2 **Act on direct reports only; deeper is view-only** | ✅ Built | `canActOnEmployee` vs `canViewEmployee`; enforced on every write route                                                                                                                                          |
| §4.2 404 not 403 (no existence oracle)                   | ✅ Built | Verified on every Phase 3a/3b route                                                                                                                                                                             |
| §4.3 Roles additive, "most access wins"                  | ✅ Built | `capabilitiesFor` ORs; no hybrid roles exist                                                                                                                                                                    |
| §4.4 My Tasks vs Oversight, by assignment                | ✅ Built | `lib/pms/tasks.ts`, `components/pms/MyTasksOversight.tsx`                                                                                                                                                       |
| §4.5 **Salary/bonus: HR, COO, Ops Director only**        | ✅ Built | `canViewCompensation`; a dedicated ESLint rule (`no-restricted-export-column`) stops the column reaching a payload. Salary is additionally **encrypted at rest** (AES-256-GCM, ADR-067) — beyond what §4.5 asks |

## §5 Goal-setting workflow

| Clause                                                                                   | Status   | Evidence                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| §5.1 The six-step sequence                                                               | ✅ Built | Cycle → draft → review → both sign → HR approves                                                                                           |
| §5.1 **HR approval is the LOCK; sign-off is only agreement**                             | ✅ Built | `goalsApprovedAt` gates edits; signatures do not                                                                                           |
| §5.2 Six authored texts per KPI                                                          | ✅ Built | `kpis_texts_not_blank_check` refuses a blank descriptor                                                                                    |
| §5.3 **No reject button**                                                                | ✅ Built | POST is the only verb on sign-off; no status, no DELETE                                                                                    |
| §5.3 Weightages total exactly 100 to sign                                                | ✅ Built | One predicate shared by UI, route and approval; Decimal, not float                                                                         |
| §5.4 Hard locks; "Employee did not sign"                                                 | ✅ Built | Verbatim status strings                                                                                                                    |
| §5.5 Ladder: reminders → **skip-level AND HR in parallel** → HR intervention after grace | ✅ Built | `ComplianceKind` enum; the parallel step is asserted in one sweep. _(An earlier design had these sequential; corrected against the spec.)_ |
| §5.6 Compliance record: who, what, how late, what it took                                | ✅ Built | `ComplianceEvent`, incl. `measuredAgainstDeadline` so an HR extension re-arms the ladder                                                   |

## §6 Mid-year review

| Clause                                                    | Status   | Evidence                                                                         |
| --------------------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| §6.1 Progress check, no scoring                           | ✅ Built | Nothing on the mid-year path writes a rating                                     |
| §6.2 Manager submits a change request                     | ✅ Built | `POST /api/kpi-change-requests`                                                  |
| §6.2 Full overhaul or partial change                      | ✅ Built | Null = unchanged, end to end; only moved fields travel                           |
| §6.2 HR approves or rejects                               | ✅ Built | `POST …/decide`, HR-only                                                         |
| §6.2 **Mandatory rejection reason the manager can see**   | ✅ Built | Enforced at the boundary **and** by `kpi_change_requests_rejection_reason_check` |
| §6.3 Full version history, **archived never overwritten** | ✅ Built | `KpiVersion` snapshots the superseded state; mutation-tested                     |

## §7 Year-end assessment

| Clause                                                         | Status   | Evidence                                                                       |
| -------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| §7.1 Employee self-assesses using the goal-setting descriptors | ✅ Built | The screen shows the **five sentences the manager authored**, never a bare 1–5 |
| §7.1 Manager reviews                                           | ✅ Built | Order enforced: a manager cannot rate an unassessed KPI                        |
| §7.1 Both sign the final ratings                               | ✅ Built | `POST /api/year-end-signoffs`; requires every KPI rated by both                |
| §7.2 Manager-of-record resolved live                           | ✅ Built | Read from `Employee.managerId` at the moment of action, never snapshotted      |

## §8 Scoring model

| Clause                                      | Status                       | Evidence                                                                                   |
| ------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| §8.1 1–5 scale                              | ✅ Built                     | `kpi_ratings_level_range_check`                                                            |
| §8.2 Rating × Weightage; bucket sums to 1–5 | ⚠️ **Computable, not wired** | `individualScore()` — tested against the spec's own example (0.15 + 0.80)                  |
| §8.3 Weight table by track                  | ⚠️ Computable, not wired     | `TRACK_WEIGHTS` matches the table row for row                                              |
| §8.3 C-Level pass-through                   | ✅ Built                     | Exempt from goal-setting/self-assessment everywhere; `finalScore` returns the entity score |
| §8.4 Corporate/Departmental score entry     | ❌ **Not built**             | No model, no screen. HR has nowhere to key the Strategy team's figures                     |
| §8.5 360 ratio × 5                          | ⚠️ Computable, not wired     | `threeSixtyAsLevel()` — the spec's 0.92 → 4.60                                             |
| §8.6 Final formula                          | ⚠️ Computable, not wired     | `finalScore()` — the spec's Individual example → 3.96                                      |
| §8.7 Band mapping                           | ⚠️ Computable, not wired     | `bandFor()`, exact at every printed boundary                                               |

**What "computable, not wired" means:** the arithmetic exists and is tested, but no route calls it,
nothing is stored, and no screen shows a score. §8 cannot be finished before §8.4 (somewhere to key
Corporate and Departmental scores) and §9 (the 360 input) exist.

## §9 360 assessment module — ❌ Not built

None of it: no cycle, templates, 4-point scale, 3-rater assignment, relationship mapping,
projects, execution/reminders, or results. **`threeSixtyAsLevel()` is the only line of §9-adjacent
code**, and it converts a ratio §9 does not yet produce.

## §10 Calibration — ❌ Not built

No target distribution, no ≥5-employee threshold, no guided view, no override with mandatory
reason, no gate between raw scores and release. §10.7's sequencing gate is load-bearing: **until it
exists, no score should be released to anyone**, which is one reason §8 is deliberately unwired.

## §11 Bonus — ❌ Not built

No eligibility gate, coefficient application, pro-ration, unpaid-leave handling, or payroll export.
`BAND_COEFFICIENT` (§11.3's table) exists in `lib/pms/scoring.ts` and nothing uses it. The input
data **is** captured: `dateOfJoining`, `lastWorkingDay`, `unpaidLeaveDays`, `basicSalary` are all
imported and validated.

## §12 Edge cases

| Clause                                                             | Status       | Evidence                                                     |
| ------------------------------------------------------------------ | ------------ | ------------------------------------------------------------ |
| §12.1 Leaver status + last working day                             | ✅ Built     | Imported and validated                                       |
| §12.1 Records preserved, never deleted                             | ✅ Built     | Soft delete + audit                                          |
| §12.1 Absence from import never marks a leaver                     | ✅ Built     | §3.5's rule                                                  |
| §12.1 Pending actions close out; 360 reassignment; auto-roll-up    | ❌ Not built | Needs §9 and the roll-up prompt                              |
| §12.2 New manager inherits signed KPIs; already-signed stays valid | ✅ Built     | Nothing snapshots the manager; verified for year-end signing |
| §12.2 HR prompt for temporary roll-ups                             | ❌ Not built |                                                              |
| §12.3 Mid-cycle transfer, day-weighted split                       | ❌ Not built | Needs an assignment-period model                             |
| §12.4 Probation handled normally                                   | ✅ Built     | By construction — no probation concept exists                |

## §13 Outputs & reporting — ❌ Not built

Employee scorecard, publish gate, manager workspace dashboard, status engine, the five HR reports,
and the executive dashboard. §13.2's publish gate is the other reason §8 is unwired: **nothing is
visible to employees until deliberately published**, and the guard that enforces that does not
exist yet.

## §14 Build approach

| Clause                                                             | Status       | Evidence                                                                                                 |
| ------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------- |
| v1: Excel import, no Odoo                                          | ✅ Built     |                                                                                                          |
| v1: Excel export for payroll                                       | ❌ Not built | `lib/pms/export/xlsx.ts` exists for employee data, not the §11.7 bonus export                            |
| Import as a layer (v2-ready)                                       | ✅ Built     | A second loader drops into `loaders/`                                                                    |
| Odoo ID as stable key from day one                                 | ✅ Built     |                                                                                                          |
| **Audit everything that changes a KPI, score or published result** | ✅ Built     | Prisma audit extension + explicit `recordAudit()` on conditional updates; mandatory reasons on rejection |

## Appendix A — Core system principles

| Invariant                                             | Status              | Where it lives                                                       |
| ----------------------------------------------------- | ------------------- | -------------------------------------------------------------------- |
| Mirrors the manual process, no redesign               | ✅ Held             | Every deviation is marked in code and listed below                   |
| **HR approval locks; sign-off signals agreement**     | ✅ Held             | `goalsApprovedAt`                                                    |
| Responsibility falls on whoever controlled the action | ✅ Held             | §5.5's ladder targets the manager, never the employee                |
| **One owner per assessment**                          | ✅ Held             | `canActOnEmployee` — direct reports only                             |
| Roles additive, no hybrids                            | ✅ Held             | `capabilitiesFor`                                                    |
| Tasks by assignment, not hierarchy                    | ✅ Held             | `lib/pms/tasks.ts`                                                   |
| Raw scores never overwritten                          | ⚠️ Not yet testable | §10 does not exist; §6.3's archive holds the analogous line for KPIs |
| Nothing visible until published                       | ❌ **Not enforced** | §13.2's gate is not built. Mitigated only by §8 being unwired        |
| Audit everything sensitive, mandatory reasons         | ✅ Held             |                                                                      |
| Silence is never destructive                          | ✅ Held             | §3.5, verified                                                       |

---

## Deviations from the specification — all deliberate, all marked in code

Nothing was changed silently. Each of these is either a gap the spec leaves or a decision the
operator made, and each is flagged in the code where it applies.

| #   | Where | What the spec says                            | What was built, and why                                                                                                                                                                                                       |
| --- | ----- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §6.2  | "if a KPI needs adjusting" — singular         | A request carries **several** edits, decided as a unit, refused off 100%. §5.3 requires exactly 100 and mid-year has no sign-off to catch a violation, so one-KPI requests would leave an approved baseline at 90% for months |
| 2   | §6.2  | Silent on re-signing after an approved change | **No re-sign invented.** `SignOff.kpiSetHash` surfaces that a signature predates the current set. **Open question for Rihal**                                                                                                 |
| 3   | §7.1  | "manager reviews"                             | The manager **sees** the self-assessment while rating. Literal reading; the cost is anchoring                                                                                                                                 |
| 4   | §7.1  | Silent on justifying a divergent rating       | A divergent manager rating **requires a reason**, in either direction. **Addition — for Rihal to confirm**                                                                                                                    |
| 5   | §8.7  | Bands printed as 4.00–4.49 and 4.50–5.00      | 4.495 belongs to no band as written. Implemented as `>=` thresholds. **For Rihal to confirm**, along with whether scores are rounded before banding                                                                           |
| 6   | §4.5  | Salary "visible only to…"                     | Also **encrypted at rest** (AES-256-GCM bound to `odooId`). Stronger than asked                                                                                                                                               |
| 7   | §5.5  | —                                             | An HR deadline extension **re-arms** the ladder (`measuredAgainstDeadline`). Without it the compliance log went silent after an extension                                                                                     |

## What it would take to finish

In dependency order. §9 and §8.4 are independent of each other and both block §8's wiring.

1. **§8.4** — a model and HR screen for Corporate (per entity) and Departmental (per department) scores.
2. **§9** — the 360 module. The largest single piece: cycle, three templates, 4-point scale, 3-rater assignment, execution, results.
3. **§8 wiring** — compute and store raw scores once §8.4 and §9 feed it.
4. **§10** — calibration, including the gate that must sit between raw scores and release.
5. **§11** — bonus, pro-ration, payroll export.
6. **§13** — scorecard, publish gate, dashboards, HR reports.
7. **§12.1/§12.3** — leaver close-out, roll-up prompt, transfer split.

## Honest limitations of this report

- **Verification ran against a local PostgreSQL fixture** (36 seeded employees), not production data.
- **The live deployment could not be confirmed from the build container.** `vercel.json` runs
  `prisma migrate deploy` before `next build`, so a failed migration fails the build and the prior
  deployment keeps serving — but that is reasoning, not evidence. Confirm on the Vercel dashboard.
- **"Built" means implemented, tested and reviewed — not accepted by Rihal.** No clause here has
  been through user acceptance with the HR team who wrote the specification.
