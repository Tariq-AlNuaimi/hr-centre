# Blueprint — Performance Management System (PMS)

Scope: prisma/schema.prisma, prisma/seed-pms.ts, prisma/seed.ts, lib/pms/**, lib/validations/employee.ts, lib/validations/cycle.ts, lib/validations/kpi.ts, lib/validations/change-request.ts, lib/validations/rating.ts, lib/pms/scoring.ts, app/api/cycles/**, app/api/kpis/**, app/api/signoffs/**, app/api/kpi-change-requests/**, app/api/kpi-ratings/**, app/api/year-end-signoffs/**, app/api/internal/cycle-sweep/**, components/layout/AppSidebar.tsx, messages/en.json, messages/ar.json, vercel.json, lib/prisma/audit-extension.ts, lib/prisma/recyclable.ts, lib/prisma/soft-delete-extension.ts, app/api/employees/**, app/api/org/**, app/api/imports/**, app/api/pms/**, app/[locale]/(dashboard)/people/**, app/[locale]/(dashboard)/org/**, app/[locale]/(dashboard)/admin/**, app/[locale]/(dashboard)/goal-setting/**, app/[locale]/(dashboard)/mid-year/**, app/[locale]/(dashboard)/year-end/**, app/[locale]/(dashboard)/page.tsx, components/pms/**, components/layout/Breadcrumbs.tsx, components/ui/button.tsx, components/ui/button-variants.ts, lib/crypto/**, scripts/encrypt-salaries.mjs, components/layout/AppSidebar.tsx, hooks/use-pms-actor.ts, eslint-rules/rules/no-restricted-export-column.mjs, scripts/neon-sql.mjs

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

| Phase | Scope                                                                                                                                               | Spec                     | Status      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------- |
| **1** | Org foundation: entities, departments, employees, additive roles, hierarchy visibility, salary confidentiality, Excel import layer                  | §1, §3, §4               | **shipped** |
| 2     | Cycles & goal-setting: cycle/stage model, hard-lock deadlines, KPI drafting, sign-offs, HR approval lock, escalation ladder, manager compliance log | §2, §5                   | **shipped** |
| 3     | Mid-year & year-end: change requests, KPI version history, self-assessment, manager review, final sign-off                                          | §6, §7                   | planned     |
| 4     | 360 module: templates, relationship mapping, assignment generation, execution, ratio scoring                                                        | §9                       | planned     |
| 5     | Scoring & money: score engine, band mapping, calibration gate, bonus + pro-ration, payroll export, publish gate                                     | §8, §10, §11, §13.1–13.2 | planned     |
| 6     | Reporting: manager workspace, status engine, HR reports, executive dashboard, master export, transfer/leaver edge cases                             | §12, §13.3–13.6          | planned     |

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
  (§5.6). **Also owed in Phase 2: an HR-role administration screen** — a way for an HR Super
  Admin to grant and revoke `Employee.pmsRoles` (§4.1/§4.3) through the UI. Until it exists, the
  only route into the PMS on a fresh deploy is `bootstrapAdminEmployee` in `prisma/seed-pms.ts`,
  which seeds one HR_SUPER_ADMIN for `SEED_ADMIN_EMAIL` and refuses to run once the database
  holds anything other than the demo fixture (guards verified in
  `docs/verification/pms-phase1/README.md` §9). That seam is deleted when this screen ships.
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

Postgres is the only durable store. Uploaded files are **not** retained: they are parsed
in-request and discarded, because they carry Restricted salary data and keeping them would
create a second, unaudited copy.

That has a consequence this section previously got wrong. It used to claim the confirm step
"re-reads the reviewed diff rather than re-parsing an uploaded file". It cannot: the rows that
would actually be written carry salary figures, so they are deliberately **not** persisted in
`ImportBatch.previewJson` — that column is read back by any HR user who can see the batch.
Only the human-facing plan is stored. The confirm step therefore **re-parses the file the
operator re-submits** and re-derives the plan against a live org.

So "the operator confirms exactly what they were shown" is a claim that needs enforcing rather
than a structural fact. Two checks enforce it, and they catch different things:

- **The three plan counts** catch the ORG moving under a plan — another admin adding someone
  turns a create into an update.
- **A `planDigest`** (SHA-256 over the rows the plan would write, sorted by `odooId` so file
  order is not content) catches a different FILE. Counts alone do not: two sheets with one
  create each produce identical counts while writing entirely different people. The digest is
  persisted inside `previewJson` and re-checked at apply; a mismatch refuses and asks for a
  fresh preview.

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

---

## Phase 2 — Cycles, goal-setting, sign-offs & escalation (§2, §5)

Clause text was re-read from the source specification for this phase, so the rules below are
quoted behaviour, not reconstruction.

### The rules being implemented

| Clause | Rule                                                                                                                                                                                                                                                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §2     | Annual cycle, three touchpoints: goal-setting (December of prior year), mid-year (June/July, **no scoring**), year-end (December). HR sets each stage's deadline; deadlines are **hard locks**.                                                                                                                                   |
| §5.1   | HR opens cycle → manager drafts → employee reviews → **both** sign (agreement) → HR reviews and approves → **HR approval is the lock**. Sign-off is agreement, never the lock.                                                                                                                                                    |
| §5.2   | Per KPI: description, weightage %, and **five** level descriptors — Outstanding 5, Excellent 4, Target 3, Almost Achieved 2, Unsatisfactory 1.                                                                                                                                                                                    |
| §5.3   | **No reject button.** Unsigned _is_ the disagreement signal; discussion is offline. KPIs cannot be signed or locked unless weightages total **exactly 100%**.                                                                                                                                                                     |
| §5.4   | After a deadline the relevant party can no longer act. Employee misses → locks with status "Employee did not sign", set moves to HR review.                                                                                                                                                                                       |
| §5.5   | Ladder: approaching deadline → escalating reminders to the manager; **deadline missed → skip-level AND HR notified in parallel**, compliance logging begins; still unresolved **after the grace window** → HR intervenes formally. Manager's own sign-off step follows the same logic, status "employee signed, manager did not". |
| §5.6   | Log manager name, what was missed, by how long, and whether skip-level or HR intervention was required. Feeds §11.2.                                                                                                                                                                                                              |
| §8.3   | **C-Level skip goal-setting entirely.**                                                                                                                                                                                                                                                                                           |
| §12.2  | Manager-of-record is **whoever holds the relationship at the time of each action**; a new manager inherits signed KPIs, and signed work stays locked and valid.                                                                                                                                                                   |

### Data model (Phase 2)

```prisma
enum CycleStatus    { DRAFT  OPEN  CLOSED }
enum CycleStageKind { GOAL_SETTING  MID_YEAR  YEAR_END }        // §2's three touchpoints
enum SignOffParty   { EMPLOYEE  MANAGER }                       // §5.1 — exactly two parties
enum ComplianceKind { REMINDER_SENT  DEADLINE_MISSED  ESCALATED_SKIP_LEVEL
                      ESCALATED_HR  HR_EXTENDED_DEADLINE  HR_MARKED_NON_COMPLIANT }

model PerformanceCycle { id, year @unique, status, openedById, openedAt }
model CycleStage       { id, cycleId, kind, opensAt, deadline, graceDays @default(3)
                         @@unique([cycleId, kind]) }
model CycleParticipant { id, cycleId, employeeId, goalsApprovedAt?, goalsApprovedById?
                         @@unique([cycleId, employeeId]) }
model Kpi              { id, participantId, description, weightage Decimal(5,2),
                         descriptorOutstanding, descriptorExcellent, descriptorTarget,
                         descriptorAlmostAchieved, descriptorUnsatisfactory, orderIndex }
model SignOff          { id, participantId, party, signedByEmployeeId, signedAt
                         @@unique([participantId, party]) }
model ComplianceEvent  { id, cycleId, stageKind, subjectEmployeeId, managerEmployeeId?,
                         kind, missedByHours?, detail, occurredAt }
```

### Three design decisions

- **Five descriptors are five columns, not a child table.** §5.2 fixes exactly five levels.
  Columns make "exactly five" true by construction; a child table would permit four or six and
  then need a constraint to forbid what the schema should not have been able to express.
- **`CycleParticipant` does not snapshot `managerId`.** §12.2 defines manager-of-record as
  whoever holds the relationship _at the time of each action_, so the manager is resolved live
  from `Employee.managerId` and only the _signer_ is recorded, on the `SignOff` row.
  Snapshotting would leave a reassigned manager unable to act on their own reports, and §12.2 is
  explicit that a new manager picks up from wherever things stand.
- **No `REJECTED` state anywhere.** §5.3 is explicit that unsigned is the signal. A reject action
  would invent process the spec deliberately omits, and would give an employee a button whose
  real-world meaning ("we have not agreed yet") the absence of a signature already carries.

### User stories & acceptance criteria (Phase 2)

**US-9 — HR opens a performance year.**
_Accepts when:_ HR Super Admin or HRBP creates a cycle for a year, sets a deadline for each of
the three stages, and opens it; every ACTIVE employee becomes a participant; re-running
enrolment after an import adds only the joiners (§3.5) and disturbs nobody.

**US-10 — A manager drafts KPIs for a direct report.**
_Accepts when:_ a line manager can author KPIs — description, weightage, all five descriptors —
for a **direct report only**; a report two levels down is view-only (§4.2); a C-Level employee
has no goal-setting step at all (§8.3).

**US-11 — Weightages must total exactly 100% to sign.**
_Accepts when:_ a draft may sit at any total while being edited, and sign-off is refused at
99.99% with the gap stated (§5.3).

**US-12 — Both parties sign; HR's approval is what locks.**
_Accepts when:_ employee and manager sign independently, in either order; neither signature
prevents further edits; **HR approval** freezes the KPI set, after which an edit is refused
(§5.1).

**US-13 — A deadline is a hard lock.**
_Accepts when:_ one second past a stage deadline the party can no longer act; an employee who
did not sign shows "Employee did not sign" and their set moves to HR review (§5.4).

**US-14 — A missed manager deadline reaches HR and the skip-level at the same moment.**
_Accepts when:_ the sweep emits `DEADLINE_MISSED`, `ESCALATED_SKIP_LEVEL` and `ESCALATED_HR` in
the **same** run — not staged behind the grace window — and the grace window gates only HR's
formal intervention (§5.5). Re-running the sweep never double-logs.

**US-15 — The compliance record answers §11.2's question.**
_Accepts when:_ each event records the manager, what was missed, by how long, and whether it
required skip-level or HR intervention (§5.6).

**US-16 — HR grants HR roles through the UI.**
_Accepts when:_ an HR Super Admin can grant and revoke `pmsRoles` on the employee record,
retiring the seed-time bootstrap in `prisma/seed-pms.ts` (the Phase 1 stopgap recorded there).

### Scenarios

**Happy path.** HR opens 2027 with three deadlines → the Engineering Director drafts four KPIs
for each direct report, weightages summing to 100 → each employee reads the descriptors and
signs → the manager signs → HR approves → the set is locked and visible to the chain, without
salary anywhere near it.

**Worst paths.**

- **Manager never drafts.** Employee is blocked through no fault of their own (§5.5's stated
  principle). Reminders escalate; at the deadline the skip-level director and HR are notified
  together; after the grace window HR extends, intervenes, or marks formal non-compliance —
  each of those a logged event.
- **Employee never signs.** The stage locks, status reads "Employee did not sign", and the set
  moves to HR review. Responsibility sits with the employee (§5.4) — the manager is not marked
  non-compliant for it.
- **Employee signed, manager did not.** Flagged to HR and skip-level with that exact status
  string (§5.5).
- **Weightages total 95%.** Draft saves; sign-off refuses and says which 5% is missing (§5.3).
- **Manager leaves mid-cycle.** Reports roll up one level (§12.1); the new manager inherits the
  signed baseline and does not re-draft (§12.2); signatures already given stay valid.
- **HR approves, then a manager tries to "just fix a typo".** Refused — approval is the lock
  (§5.1). The correction path is Phase 3's change request (§6.2), which is where an audited
  amendment belongs.
- **The sweep runs twice in a day** (a retry, or a manual invocation). Idempotent per
  participant/stage/kind, so the compliance record stays honest.

### Out of Phase 2

Mid-year change requests and KPI version history (§6, Phase 3); any scoring (§2 is explicit that
scoring happens once, at year-end); 360 (§9); calibration and bonus (§10, §11); and §12.3's
mid-cycle transfer split, which needs `EmployeeAssignmentPeriod` from Phase 6.

## Phase 3 — Mid-year change requests, KPI version history & year-end assessment (§6, §7)

Delivered as **3a then 3b**, two PRs, each green and deployed before the next starts. 3b builds
directly on 3a's versioning, so a defect in the version model is cheaper to find with §7 unbuilt.

### The rules being implemented

Quoted from `docs/PMS_Functional_Specification_v1.0.docx`, not reconstructed.

| Clause | Rule                                                                                                                                                                                                                                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §6.1   | Mid-year is "a progress check and chance to adjust — **no scoring, no ratings issued**".                                                                                                                                                                                                                               |
| §6.2   | The manager submits a change request. It may be a **full overhaul** (description + weight + all five descriptors) or a **partial change**. HR approves or rejects. On approval the new version takes effect. On rejection the KPI stays unchanged and **HR must enter a reason (mandatory) that the manager can see**. |
| §6.3   | Full version history of every change: original version, what changed across **all** fields, who requested, who approved, and when. "Old versions are archived, never overwritten."                                                                                                                                     |
| §7.1   | Employee self-assesses against each KPI **using the five-level descriptors defined at goal-setting** → manager reviews → offline discussion → **both sign off on the final ratings**.                                                                                                                                  |
| §7.2   | Manager-of-record is whoever holds the relationship **at the moment of the action**. Whoever is manager at year-end signs the year-end assessment.                                                                                                                                                                     |
| §8.1   | All components resolve onto 1–5: Outstanding 5, Excellent 4, Target 3, Almost Achieved 2, Unsatisfactory 1. Phase 3 **captures** these; Phase 5 scores them.                                                                                                                                                           |
| §8.3   | C-Level skip goal-setting, **self-assessment** and 360 entirely.                                                                                                                                                                                                                                                       |
| §5.4   | Carried forward: deadlines are hard locks. The same lock now governs the MID_YEAR and YEAR_END stages.                                                                                                                                                                                                                 |

### Data model (Phase 3)

```prisma
enum ChangeRequestStatus { PENDING  APPROVED  REJECTED  WITHDRAWN }
enum RatingParty         { EMPLOYEE  MANAGER }

// §6.2 — one request, several edits, decided as a unit.
model KpiChangeRequest {
  id, participantId, requestedByEmployeeId, requestedAt, status,
  rationale,               // CHECK: non-blank — HR decides ON it (§6.2)
  decidedByEmployeeId?, decidedAt?,
  decisionReason?          // CHECK: NOT NULL and non-blank when status = REJECTED (§6.2)
  edits KpiChangeRequestEdit[]
  @@index([participantId, status])
  // Plus a PARTIAL unique index Prisma cannot express, created in the migration:
  //   ("participant_id") WHERE status = 'PENDING'      -- see decision 6
}

// A null column means "unchanged" — that is how §6.2's PARTIAL change is expressed.
model KpiChangeRequestEdit {
  id, requestId, kpiId,
  description?, weightage?, descriptorOutstanding?, descriptorExcellent?,
  descriptorTarget?, descriptorAlmostAchieved?, descriptorUnsatisfactory?
  @@unique([requestId, kpiId])   // one edit per KPI per request
}

// §6.3 — a FULL snapshot of the KPI as it stood before it was superseded.
model KpiVersion {
  id, kpiId, versionNo,
  description, weightage, five descriptors, orderIndex,   // complete, not a diff
  supersededAt, supersededByRequestId?
  @@unique([kpiId, versionNo])
}

// §7.1 — the ratings themselves. Level is 1–5 (§8.1); Phase 5 turns it into a score.
model KpiRating {
  id, kpiId, party, level Int, comment?, ratedByEmployeeId, ratedAt
  @@unique([kpiId, party])       // one self-assessment, one manager review
}
```

**`SignOff` gains `stageKind`.** Its identity is `@@unique([participantId, party])` today, which
silently assumes sign-off happens once. §7.1 needs a _second_ pair of signatures at year-end, on
the same participant. The key becomes `@@unique([participantId, stageKind, party])`, backfilled to
`GOAL_SETTING` for every existing row. Without this, a year-end signature would collide with the
goal-setting one and be reported as "already signed" — the §5.1 flow silently swallowing §7.1's.

### Five design decisions

1. **Archive-on-write, not immutable-versions-with-a-pointer.** Approving a change first copies the
   live `Kpi` into a `KpiVersion` row, then updates the live row. Every Phase 2 read path — the
   §5.3 weightage total, `KPI_SELECT`, the drafting screen, the sign-off hash — keeps working
   untouched, and "show me the original version" is one indexed query. The purer model (every state
   is a version, the participant points at the current one) is a better long-term shape and rewrites
   every one of those read paths to buy it. §6.3 asks that old versions be archived and never
   overwritten; this satisfies that literally.
2. **A change request is atomic, and cannot land off 100%.** §6.2 speaks of "a KPI", but changing
   one weightage necessarily breaks §5.3's exactly-100% rule, so a rebalance (40→30 here, 20→30
   there) is ONE request approved or rejected as a unit. HR's approval is **refused** unless the
   resulting set totals exactly 100. The invariant then holds at every committed state — otherwise
   the locked baseline sits at 90% for weeks and §5.3, which only bites at sign-off, never notices.
3. **No re-signature after an approved change; the divergence is surfaced instead.** §6.2 says only
   that "the new version takes effect" — requiring a fresh signature would invent a workflow step
   with no deadline defined for it, and §5.4's hard locks would then apply to a step the spec does
   not have. Phase 2's `SignOff.kpiSetHash` already makes it visible that a signature predates the
   current set, so HR sees "signed an earlier version" rather than being misled. **Flagged to Rihal
   as a spec question**, not resolved unilaterally.
4. **The mandatory rejection reason is a database CHECK, not a required form field.** §6.2 makes it
   mandatory; a form validation is bypassable by any other writer (the import, a hand-run fix, a
   future route). Same reasoning as Phase 1's §1.2 invariant, which is enforced in both places.
5. **A withdrawn request is a status, not a delete.** A manager who thinks better of a request
   leaves a record that they asked — §6.3 wants the history of what was requested, not only of what
   was approved.
6. **At most one PENDING request per participant, enforced by a partial unique index.** Two pending
   requests are each validated against the CURRENT set, so each can total 100 on its own and still
   leave the set off 100 once both are approved — §5.3 broken by two individually-legal acts. A
   route-level check cannot close that across two requests in flight. The index is partial
   (`WHERE status = 'PENDING'`) so a participant may still accumulate any number of decided or
   withdrawn requests, which is what §6.3 asks for. Withdrawing frees the slot immediately.

### User stories & acceptance criteria (Phase 3)

**US-17 — A manager requests a mid-year change.** Given an HR-approved baseline and an open
MID_YEAR stage, the direct line manager (§4.2) submits one request carrying edits to one or more
KPIs, each edit changing any subset of the six §5.2 fields. Omitted fields are unchanged.

**US-18 — HR approves, and the new version takes effect.** On approval the pre-change state of every
touched KPI is archived to `KpiVersion`, the live rows are updated, and the request records who
decided and when. Approval is refused if the resulting weightages do not total exactly 100 (§5.3).

**US-19 — HR rejects, with a reason the manager can see.** The KPIs are unchanged. The reason is
mandatory and is shown to the requesting manager. A rejection with a blank reason is refused by the
database, not only by the form.

**US-20 — The history answers §6.3's four questions.** For any KPI: the original version, what
changed field by field, who requested it, who approved it, and when — with old versions archived
rather than overwritten.

**US-21 — Mid-year issues no ratings.** §6.1. Nothing in the mid-year path writes a `KpiRating` or
produces a score.

**US-22 — An employee self-assesses at year-end.** Against each KPI, choosing one of the five
levels **defined at goal-setting for that KPI** — the descriptors are shown, not a bare 1–5 scale.
C-Level are exempt (§8.3).

**US-23 — The manager reviews, then both sign.** The manager records their own rating per KPI;
after discussion offline, both parties sign the year-end assessment. The signature is against the
YEAR_END stage, independent of the goal-setting pair.

**US-24 — The year-end signer is the manager at year-end.** §7.2 — resolved live from
`Employee.managerId` at the moment of the action, never snapshotted, exactly as Phase 2 does it.

### Scenarios

**Happy path.** HR opens MID_YEAR. A manager finds a KPI's target unrealistic, submits one request
rebalancing two weightages and rewriting three descriptors. HR approves. Both KPIs' prior states
land in `KpiVersion` as v1; the live rows become v2. The set still totals 100. At YEAR_END the
employee self-assesses against the _current_ descriptors, the manager reviews, both sign.

**Worst paths.**

- _The rebalance does not add up._ HR tries to approve a request leaving the set at 95%. Refused,
  with the gap named (§5.3). Nothing is archived and nothing is updated — an approval is one
  transaction or it is not an approval.
- _A rejection with no reason._ Refused at the boundary and again by the CHECK constraint (§6.2).
- _A manager requests a change on someone else's report._ 404, not 403 — the same existence-oracle
  rule the rest of the phase uses (§4.2).
- _The MID_YEAR deadline passes with a request still pending._ §5.4's hard lock stops the manager
  editing it; HR can still decide it, because the decision is HR's action and HR owns the cycle.
- _An employee self-assesses, then the manager changes._ §7.2 — the new manager reviews and signs;
  the self-assessment stands, because it was the employee's action and their relationship did not
  change.
- _A change is approved after the employee signed goal-setting._ Permitted (US-12), and the
  employee's signature is reported as against an earlier version (decision 3).

### Out of Phase 3

Any scoring or band mapping (§8 — Phase 5, and §6.1 forbids it at mid-year); the 360 module (§9);
calibration (§10); bonus (§11); and §12.3's transfer split, which needs Phase 6's
`EmployeeAssignmentPeriod`.

## Open questions

Resolved with the operator before build:

- **Q: How much ships in the first pass?** → Phase 1 foundation; later phases follow against
  this blueprint.
- **Q: Excel contract — match an existing export, or define one?** → Define it from §3.3's
  eleven fields and ship a downloadable `.xlsx` template plus a validation report, so HR maps
  their Odoo export onto it.
- **Q: Live URL for HR review?** → Yes, deploy once Phase 1 is green (via a PR into `main`).

Resolved with the operator after Phase 1, before the phases that consume them:

- **Grace window length (§5.5)** → **HR-configurable per cycle, defaulting to 3 working days**
  after the missed deadline. Configurable because goal-setting (December) and year-end may
  warrant different patience; 3 days because a longer window on a December deadline pushes HR's
  intervention past the cycle boundary. _Builds in Phase 2._

- **360 anonymity (§13.1 / §9.4)** → **Line-manager feedback is presented as the manager's;
  the peer and third rater are pooled anonymously.**

  The spec asks for all comments consolidated and unattributed, but §9.4 fixes exactly three
  raters and one is _always_ the line manager — so an employee can usually deduce which comment
  is theirs. Pooling all three would promise an anonymity the structure cannot deliver, and a
  promise that visibly fails costs more trust than one never made. Separating the manager (whose
  feedback the employee already receives directly in the review conversation) leaves the two
  genuinely anonymous voices genuinely anonymous.

  **This is a deliberate, operator-approved divergence from §13.1's literal wording** — the only
  one in the blueprint. Appendix A's "the system mirrors the existing manual process" still
  holds in substance: the manual process never hid manager feedback either. _Builds in Phase 4._

- **Bonus rounding (§11.4)** → **Round half-up to 3 decimal places** (OMR baisa). The schema
  already stores `basicSalary` as `Decimal(14,3)`, so the money path stays exact end to end with
  no representation loss, and rounding is neither systematically generous nor systematically
  short. Implemented as a **single configurable step** so matching a different payroll
  convention later is one change, not a rework. _Builds in Phase 5._

- **Corporate/Departmental score entry (§8.4)** → **Revisable until the calibration gate opens,
  then locked**; every revision audited. This matches §10.7's sequencing ("no calibration until
  all raw scores are in") and treats a mistyped score as a typo rather than a formal override.
  After the gate opens, a change would silently invalidate the distribution HR calibrated
  against — so it becomes an audited HR Super Admin override with a mandatory reason, on the
  same footing as a calibration adjustment. _Builds in Phase 5._

**Closed 2026-08-25**, by re-reading the spec rather than by asking:

- **Transfer mid-cycle + 360 (§12.3) — 360 is NOT day-weighted.** The clause is explicit twice
  over. It names what _is_ weighted — "with departmental/corporate components day-weighted the
  same way" — and lists 360 separately as "done once at year-end (from wherever the employee sits
  then), not duplicated". So the split applies to the individual, departmental and corporate
  components; the 360 component enters the formula once, whole. Phase 6 builds it that way.

Nothing else is open against the specification.
