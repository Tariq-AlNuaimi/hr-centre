# Blueprint — Performance Management System (PMS)

Scope: prisma/schema.prisma, prisma/seed-pms.ts, prisma/seed.ts, lib/pms/**, lib/validations/employee.ts, lib/prisma/audit-extension.ts, lib/prisma/recyclable.ts, lib/prisma/soft-delete-extension.ts, app/api/employees/**, app/api/org/**, app/api/imports/**, app/api/pms/**, app/[locale]/(dashboard)/people/**, app/[locale]/(dashboard)/org/**, app/[locale]/(dashboard)/admin/**, components/pms/**, components/layout/AppSidebar.tsx, hooks/use-pms-actor.ts, eslint-rules/rules/no-restricted-export-column.mjs, scripts/neon-sql.mjs

> Source of truth: `Performance_Management_System.docx` v1.0 (2026-08-24), supplied by the
> operator's HR team. Section references (§) throughout this document point at that
> specification. Where this blueprint and the spec disagree, **the spec wins** — its
> Appendix A invariants are the acceptance bar.
>
> Governance of record: ADR-065 (identity & roles), ADR-066 (Excel engine).

## Problem & outcome

Rihal Group (Rihal parent + TP and CL subsidiaries) runs an annual performance cycle by
hand: managers set KPIs in December, a mid-year check happens in June/July, year-end
produces a rating, a Strategy team supplies corporate and departmental scores offline, HR
runs a bell-curve calibration, and bonuses are computed against basic salary. Today this
lives in spreadsheets and email. That means no enforced deadlines, no audit trail behind a
score change, no objective record of which manager missed which step, and salary/bonus
confidentiality resting on who was cc'd.

**This system does not redesign the methodology** (Appendix A, invariant 1). It implements
the existing process as software and adds the three things the manual process cannot give:
**auditability**, **deadline governance**, and **reporting**.

**Outcome when complete:** HR opens a cycle and the system drives it — managers draft KPIs
against hard deadlines with an escalation ladder behind them, employees self-assess against
descriptors they agreed to in December, 360 assessments run on the same performance year,
raw scores compute automatically, HR calibrates in a gated layer that never overwrites raw
scores, bonuses pro-rate to payroll's ÷365 convention, and nothing reaches an employee until
HR deliberately publishes. Every score change, KPI edit, override, and un-publish carries a
who/when/why.

## Market scan

Benchmarked before designing (CLAUDE.md: market benchmark before building):

| Product                            | Fit                                       | Why not adopted                                                                                                                                                                                                                                                                        |
| ---------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Odoo Appraisals**                | Already in-stack — the org runs Odoo HRIS | No weighted multi-component scoring (corporate/departmental/individual/360 by role track), no calibration layer, no band→coefficient bonus engine. It is the **source of employee data** (§3.1 v2), not the engine.                                                                    |
| **Lattice / Culture Amp / 15Five** | Mature review + 360 + calibration         | SaaS, per-seat, US-hosted; the scoring model is theirs, not Rihal's. §8.3's exact weight matrix and §11.4's ÷365 pro-ration are not configurable in any of them. Rihal's methodology is the fixed requirement — Appendix A invariant 1 rules out adopting a tool that imposes its own. |
| **PerformYard / Trakstar**         | Cheaper, configurable forms               | Same structural mismatch: no per-role-track weight distribution, no entity/department score injection from an offline Strategy team.                                                                                                                                                   |

**Reused rather than rebuilt** (anti-duplication check, per CLAUDE.md pillar 3):
`lib/api-helpers.ts` wrappers, `lib/prisma/audit-extension.ts` (audit comes free on every
write), `lib/prisma/soft-delete-extension.ts` + recycling bin, `lib/pagination.ts`,
`lib/rate-limit.ts`, `lib/validations/common.ts`, and the whole `components/shared/*` +
`components/ui/*` primitive set. The only new third-party dependency is an Excel engine
(ADR-066).

## Tier

`project.config.json` tier applies unchanged. The security floor is identical either way;
this system handles **Restricted** data (basic salary, computed bonus — SECURITY.md §1) and
is treated accordingly regardless of tier.

---

## Phasing

The full system is ~25 models. It ships in six phases; each phase ends green (`npm run ship`)
and lands on `main`. **Phase 1 is the bedrock**: §3.2 makes every downstream record
(KPIs, sign-offs, 360 assignments, scores, audit entries) attach to the Odoo employee ID, so
the employee table and its import layer are built and validated against real HR data before
anything is stacked on them.

| Phase | Scope                                                                                                                                               | Spec                     | Status          |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------- |
| **1** | Org foundation: entities, departments, employees, additive roles, hierarchy visibility, salary confidentiality, Excel import layer                  | §1, §3, §4               | **in progress** |
| 2     | Cycles & goal-setting: cycle/stage model, hard-lock deadlines, KPI drafting, sign-offs, HR approval lock, escalation ladder, manager compliance log | §2, §5                   | planned         |
| 3     | Mid-year & year-end: change requests, KPI version history, self-assessment, manager review, final sign-off                                          | §6, §7                   | planned         |
| 4     | 360 module: templates, relationship mapping, assignment generation, execution, ratio scoring                                                        | §9                       | planned         |
| 5     | Scoring & money: score engine, band mapping, calibration gate, bonus + pro-ration, payroll export, publish gate                                     | §8, §10, §11, §13.1–13.2 | planned         |
| 6     | Reporting: manager workspace, status engine, HR reports, executive dashboard, master export, transfer/leaver edge cases                             | §12, §13.3–13.6          | planned         |

---

## Architecture

### The five decisions that shape everything downstream

**1. `Employee` is its own table, separate from Auth.js `User`.**
The employee record is org data loaded from Excel (§3.1); the `User` is a login identity.
They are not the same population: the Strategy team has **no system access** (§4.1), leavers
keep records forever (§12.1), and employees exist in the system before they ever log in.
`Employee.odooId` is the permanent unique key (§3.2) — upserts key on it and it never shifts.
`Employee.userId` is a nullable unique link, populated when a person needs to sign in.

**2. PMS roles are additive and live on `Employee`; the platform `Role` enum is untouched.**
`Role { ADMIN, EDITOR, VIEWER }` keeps its existing meaning (platform administration).
PMS authority is a separate, additive set:

```prisma
enum PmsRole { HR_SUPER_ADMIN  HRBP  EXECUTIVE_VIEWER }
```

`EMPLOYEE` is not a member — everyone is one. `LINE_MANAGER` is not a member either: manager
authority is **derived** from `Employee.managerId` edges. That is what makes §4.2's "editing
and sign-off is always reserved for the direct line manager" and Appendix A's "one owner per
assessment" structurally true rather than a convention someone can misconfigure. Permissions
merge "most access wins" (§4.3); there are no hybrid roles.

**3. Hierarchical visibility resolves in one recursive CTE.**
§4.2 requires a manager to see down their **entire** chain, however deep, while acting only
on direct reports. `lib/pms/org-tree.ts` resolves descendant IDs in a single recursive CTE
(`$queryRaw` with placeholders, explicit column list, depth cap, cycle-safe) and hands a
bounded ID set to a normal paginated Prisma query — no N+1, bounded payload (pillars 1, 4).

**4. Salary confidentiality is enforced where the data is selected, never in the UI.**
§4.5 is unusually strict: line managers never see salary or bonus, _even for their own direct
reports_, _even in chain view_. `lib/pms/employee-select.ts` builds the Prisma `select` from
the actor's capabilities, so `basicSalary` never enters the response payload for an
unauthorised actor. It also joins `SCRUB_FIELDS` so it never lands in an audit row.

**5. Import is a layer; Excel is loader #1 and Odoo is loader #2.**
§3.1 mandates an import layer writing into an internal employee table the system owns, with
downstream logic never reading the import file. The loader boundary is a canonical
`EmployeeSourceRow`; swapping Excel for Odoo in v2 replaces one file and touches nothing else.

### Phase 1 data model

```prisma
enum PmsRole        { HR_SUPER_ADMIN  HRBP  EXECUTIVE_VIEWER }   // §4.1, additive
enum RoleTrack      { C_LEVEL  DIRECTOR  MANAGER  LEAD  INDIVIDUAL }  // §1.3
enum EmployeeStatus { ACTIVE  LEAVER }                            // §3.3
enum ImportStatus   { PREVIEWED  APPLIED  DISCARDED }

model OrgEntity  { id, code @unique, name, departments[], employees[] }   // Rihal / TP / CL, §1.2
model Department { id, name, entityId → OrgEntity                          // §1.2 unique per entity
                   @@unique([entityId, name]) }

model Employee {
  id, odooId @unique,                       // §3.2 permanent key, never shifts
  name, email @unique,
  departmentId?, entityId,                  // entity denormalised; C-Level: entity, no dept (§1.2)
  managerId? → Employee,                    // §3.3 self-relation: sign-off, escalation, visibility, 360
  roleTrack, pmsRoles PmsRole[],            // §1.3, §4.3
  basicSalary Decimal?,                     // RESTRICTED — §4.5 / §11.6
  status, lastWorkingDay?, unpaidLeaveDays, // §3.3, §12.1, §11.5
  userId? @unique → User,                   // login link, nullable
  deletedAt?, deletedBy?, createdAt, updatedAt
}

model ImportBatch    { id, filename, status, uploadedById, rowsTotal/Created/Updated/Rejected,
                       previewJson, appliedAt, issues[] }
model ImportRowIssue { id, batchId, rowNumber, odooId?, field, rule, message, severity }
```

**Invariant** (zod + a migration CHECK constraint): an employee has a department, XOR is
`C_LEVEL` with a direct entity (§1.2). `department.entityId` must equal `employee.entityId`.

### Later-phase models (designed for now, built later)

Recorded so the Phase 1 schema stays forward-compatible and no later phase forces a rewrite.

- **Phase 2** — `PerformanceCycle` (year, status), `CycleStage` (stage, opensAt, deadline —
  hard locks, §5.4), `CycleParticipant`, `Kpi` (description, weightage, five level descriptors,
  §5.2), `SignOff` (party, signedBy, signedAt — agreement, not lock, §5.1), `ComplianceEvent`
  (§5.6).
- **Phase 3** — `KpiVersion` (archived, never overwritten, §6.3), `KpiChangeRequest`
  (mandatory rejection reason, §6.2), `KpiRating` (self / manager / final, §7.1).
- **Phase 4** — `Feedback360Cycle`, `Feedback360Template` (three types, §9.2),
  `Feedback360Question`, `Feedback360Assignment` (exactly 3 per employee, §9.4),
  `Feedback360Response`, `Project` + `ProjectMember` (§9.6).
- **Phase 5** — `ComponentScore` (entity/department scores keyed in by HR, §8.4),
  `FinalScore` (raw + calibrated, never overwritten, §10.1), `CalibrationAdjustment`
  (mandatory reason, §10.5), `TargetDistribution` (§10.2), `BonusRecord` (Restricted, §11),
  `PublishEvent` (reversible + audited, §13.2).
- **Phase 6** — `EmployeeAssignmentPeriod` for mid-cycle transfers (§12.3 day-weighted split).

### Template surfaces this phase touches (and why each is unavoidable)

Four files outside the PMS's own tree change, each as a direct consequence of
introducing a Restricted column and three new models. They are named here so the
footprint is explicit rather than discovered in a diff:

| File                                                              | Change                                         | Why it is forced                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/prisma/audit-extension.ts`                                   | `basicSalary` → `SCRUB_FIELDS`                 | The data rules require it the moment a Restricted column exists: `audit_logs` is retained a year and served to platform admins, so an unscrubbed salary would route the figure around §4.5 entirely.                                                                                                                                                         |
| `eslint-rules/rules/no-restricted-export-column.mjs`              | `basicSalary` → `RESTRICTED_EXPORT_KEYS`       | `tests/contracts/export-column-completeness.test.ts` asserts `SCRUB_FIELDS ⊆ RESTRICTED_EXPORT_KEYS`. Anything redacted from the audit trail must also be banned as an export column. §11.7's payroll export is the one legitimate exception and carries a single-line disable at its own column definition, so the decision sits in a diff a reviewer sees. |
| `scripts/neon-sql.mjs`                                            | `basicSalary` → `REDACT_FIELDS`                | A parity test keeps this a superset of `SCRUB_FIELDS`, so a `select *` in the diagnostics helper cannot print salaries to a terminal.                                                                                                                                                                                                                        |
| `lib/prisma/soft-delete-extension.ts`, `lib/prisma/recyclable.ts` | register `Employee`, `Department`, `OrgEntity` | Soft delete is opt-in per model. Note this is for **erroneous records only** — a departure is `status = LEAVER` (§12.1), never a delete.                                                                                                                                                                                                                     |

`components/layout/AppSidebar.tsx` gains capability-gated nav entries; `prisma/seed.ts`
calls the (idempotent) PMS fixture.

### Phase 1 routes & services

| Route                     | Methods   | Wrapper         | Notes                                                                                                                                                                                                                                                                                           |
| ------------------------- | --------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/employees`          | GET       | `withAuth`      | Role-scoped list; paginated; select built from actor capabilities                                                                                                                                                                                                                               |
| `/api/employees/[id]`     | GET, PUT  | `withAuth`      | PUT restricted to HR (`canConfigure`)                                                                                                                                                                                                                                                           |
| `/api/org/entities`       | GET, POST | `withAuth` / HR | Entity setup                                                                                                                                                                                                                                                                                    |
| `/api/org/departments`    | GET, POST | `withAuth` / HR | Department setup, unique per entity                                                                                                                                                                                                                                                             |
| `/api/imports`            | GET, POST | HR only         | POST = upload → **dry-run preview**; GET = batch history                                                                                                                                                                                                                                        |
| `/api/imports/[id]/apply` | POST      | HR only         | Confirm step; applies a previewed batch                                                                                                                                                                                                                                                         |
| `/api/imports/template`   | GET       | HR only         | Downloadable `.xlsx` column template                                                                                                                                                                                                                                                            |
| `/api/pms/me`             | GET       | `withAuth`      | The caller's own capabilities, so the chrome can render §4.4's My Tasks / Oversight split. Returns capabilities only — never the data they gate. Served per-request rather than baked into the session JWT, so an HR role change takes effect immediately instead of at token expiry (ADR-065). |

All compose `withRateLimit` **outside** the auth wrapper. The upload route additionally caps
file size, sheet count, and row count before parsing (untrusted-file surface).

Services live in `lib/pms/`: `permissions.ts`, `actor.ts`, `org-tree.ts`,
`employee-select.ts`, `import/{types,validate,reconcile,run}.ts`, `import/loaders/xlsx.ts`.
UI → API route → service → Prisma; no component touches `prisma`.

### Where state lives

Postgres is the only durable store. Import previews persist as `ImportBatch.previewJson` so
the confirm step re-reads the reviewed diff rather than re-parsing an uploaded file — the
operator confirms exactly what they were shown. Uploaded files themselves are **not**
retained: they are parsed in-request and discarded (they carry Restricted salary data;
retaining them would create a second, unaudited copy).

---

## User stories & acceptance criteria (Phase 1)

**US-1 — HR imports the org from Excel.**
As an HR Super Admin I upload the employee sheet and see exactly what will change before
anything is written.
_Accepts when:_ upload returns a preview listing creates, field-level update diffs, and
rejects with reasons; nothing is written until I confirm; the applied batch is recorded with
counts and my identity.

**US-2 — A bad sheet cannot corrupt the org.**
_Accepts when:_ each §3.4 rule (missing/duplicate employee ID, invalid role track,
unrecognised department, unresolvable manager, invalid status) rejects its row with a stated
reason, and a rejected row never reaches the database.

**US-3 — A truncated export never deletes anyone.**
_Accepts when:_ importing a file that omits existing employees changes nothing about them —
no deletion, no status change. (Appendix A: "silence is never destructive.")

**US-4 — Re-import is safe and keys are stable.**
_Accepts when:_ importing the same file twice is idempotent and no employee's `odooId` or
internal `id` shifts (§3.2).

**US-5 — A manager sees their whole chain but acts only on direct reports.**
_Accepts when:_ a manager's directory shows every descendant at any depth and nothing outside
their subtree; edit affordances appear only for direct reports.

**US-6 — A manager never sees salary.**
_Accepts when:_ the API response for a direct report contains **no `basicSalary` key at all**
for a line-manager actor — asserted on the payload, not on the rendering (§4.5).

**US-7 — HR and executives see compensation.**
_Accepts when:_ HR Super Admin, HRBP, COO, and Ops Director see basic salary; the executive
view is read-only (§4.1, §4.5).

**US-8 — HR sets up the org structure.**
_Accepts when:_ HR creates the three entities and their departments; department names are
unique within an entity but may repeat across entities ("TP Sales" ≠ "CL Sales", §1.2).

## Scenarios

### Happy path

HR creates Rihal/TP/CL and their departments → downloads the `.xlsx` template → fills it from
the Odoo export → uploads → preview shows 40 creates, 0 updates, 0 rejects → confirms → the
directory shows the full org tree → a manager logs in and sees their chain without salary →
the COO logs in and sees org-wide with salary, read-only.

### Worst paths

- **Truncated export.** HR uploads a filtered sheet containing 12 of 40 employees. Preview
  shows 0 creates, ≤12 updates, and **0 deletions**; the other 28 are untouched (US-3).
- **Manager cycle.** The sheet makes A report to B and B report to A. The row is rejected with
  a cycle reason; the chain query terminates at the depth cap instead of hanging (US-2, US-5).
- **C-Level with a department.** Rejected — C-Level is tagged to an entity directly (§1.2).
- **Unknown department.** Rejected, not auto-created: departments are an HR setup decision, and
  silently creating "Marketting" from a typo would fork the org (US-2).
- **Manager forwards a screenshot of the directory.** Nothing to leak — salary was never in the
  payload their browser received (US-6).
- **Employee ID reused for a different person.** The upsert updates in place by design (§3.2:
  IDs never shift). The batch records the name/email change so HR can see it happened.
- **Leaver re-appears in a later file.** Status flips back to ACTIVE via the normal update path;
  the change is audited like any other.

## Five Pillars

1. **Speed & Velocity** — server components for the directory; one recursive CTE instead of
   per-level queries; paginated lists; the import preview is computed once and persisted rather
   than recomputed on confirm.
2. **Secure** — auth wrappers + zod on every route; `withRateLimit` outside; Restricted salary
   gated at the select and scrubbed from audit rows; upload caps on size/sheets/rows before
   parsing; no formula evaluation on parse; HR-only write surface.
3. **Maintainable** — reuses the existing wrapper/pagination/audit/soft-delete/UI primitives;
   the loader seam means the Odoo migration replaces one file; enums mirror the spec's own
   vocabulary so the code reads like §1.3.
4. **Scalable** — every list bounded and paginated; descendant resolution is one depth-capped
   query; import is batched, not row-by-row round trips.
5. **High-Quality** — honest empty/loading/error states; the import preview _is_ the error
   surface (rejects shown with reasons and row numbers); axe-clean; dark mode and RTL.

## Open questions

Resolved with the operator before build:

- **Q: How much ships in the first pass?** → Phase 1 foundation; later phases follow against
  this blueprint.
- **Q: Excel contract — match an existing export, or define one?** → Define it from §3.3's
  eleven fields and ship a downloadable `.xlsx` template plus a validation report, so HR maps
  their Odoo export onto it.
- **Q: Live URL for HR review?** → Yes, deploy once Phase 1 is green.

Still open, and **not blocking Phase 1** — they land with the phase that needs them:

- **Corporate/Departmental score entry (§8.4).** The Strategy team has no system access and HR
  keys their scores in. Is that one score per entity/department per year, or can it be revised
  after entry? Assumption: revisable until the calibration gate opens, with every revision
  audited. _Needed by Phase 5._
- **Grace window length (§5.5).** "Still unresolved after a grace window → HR intervenes." The
  spec does not fix the duration. Assumption: an HR-configurable setting per cycle, defaulting
  to 3 working days. _Needed by Phase 2._
- **360 anonymity floor (§13.1).** Comments are consolidated and unattributed, but with exactly
  3 raters (one of them always the line manager, §9.4) a reader can often infer the source.
  Flagged for HR: is that acceptable, or should manager feedback be presented separately from
  the two anonymous raters? _Needed by Phase 4._
- **Transfer mid-cycle + 360 (§12.3).** 360 runs once from wherever the employee sits at
  year-end, but their KPI score is day-weighted across two departments. Confirm the 360
  component is **not** day-weighted. Assumption: not weighted, per §12.3's "done once". _Needed
  by Phase 6._
- **Bonus rounding (§11.4).** `(coefficient × salary) × (workDays ÷ 365)` will rarely land on a
  whole unit. Payroll's rounding convention is unstated. _Needed by Phase 5._
