# Blueprint — Joiners, movers & leavers (JML module)

Scope: lib/jml/**, lib/validations/jml/**, app/api/jml/**, app/api/internal/jml-sweep/**, app/[locale]/(dashboard)/jml/**, components/jml/**, prisma/seed-jml.ts, prisma/seed-jml-*.ts, lib/working-time/**, lib/statutory/**, lib/people/employee-code.ts, lib/people/provisional-id.ts, lib/people/odoo-id.ts, lib/people/write.ts, lib/people/record.ts, lib/pms/departure.ts, lib/pms/transfer-apply.ts, lib/pms/import/**, lib/pms/employee-select.ts, lib/pms/notifications.ts, lib/validations/people.ts, lib/validations/employee.ts, lib/rbac/catalogue.ts, app/api/notifications/**, app/api/employees/**, app/[locale]/(dashboard)/people/**, components/people/**, components/layout/**, prisma/schema.prisma

Status: AUTHORISED by the operator for an overnight build (brief of 2026-10-26: "build HR
Centre's joiners, movers & leavers module by porting HR Onboarding and HR Offboarding … as one
module with one shared case model"). Delivered in slices; each slice has its own build notes in
`docs/blueprints/jml-s<N>-*.md` and is merged, deployed and verified before the next.

Contracts this module traces to (kept verbatim — `/qa` traces against their IDs):

- HR Onboarding artifact v1.2 (§n, BR-nnn, AC-xxx) and its blueprints (US1–US11, R1–R10).
- HR Offboarding artifact v1.1 (FR-OFF-_, BR-OFF-_, AC-OFF-\*, C1–C11, T1–T19, O1–O20).
- Port inventories: `onboarding.md` / `offboarding.md` (the session's port specs). Their defect
  lists (offboarding §0 F1–F24, onboarding §8.4 1–12) are FIXED here, not copied.

## Problem & outcome

Rihal runs two separate prototype apps for people joining and leaving, each with its own copy
of the org, its own HR roles, its own working-week maths and its own notification code — and
neither touches the employee record. HR Centre already holds the one real employee record, the
org, scoped roles and the departure flow. This module moves both apps into HR Centre as **one
module with one case engine**: a case is a JOIN, a MOVE (internal change) or a LEAVE, every case
belongs to a core `Employee`, and closing a case changes that record (a joiner becomes ACTIVE, a
mover is transferred, a leaver departs).

**Outcome:** HR runs onboarding, internal changes and offboarding in HR Centre, end to end, with
every action the old apps had (including the ones those apps only exposed as APIs), and the
employee record stays the single source of truth.

## Decisions (operator brief + decisions taken while designing; ADRs 075–082)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Core changes owned by JML.** `EmployeeStatus.PRE_JOINER`; provisional `odooId` `PENDING-<cuid>` replaced by ONE audited operation that re-keys every value bound to the old id (salary, ID numbers); `Employee.employeeCode` (the EMP code, BR-003) with a core cutover/sequence; `Employee.positionClassificationId`. ADR-075.                                                                                                                                                                                                                              |
| D2  | **One employment-type list** = the union of Onboarding (9), Offboarding (6) and the foundation's `contractType` (5), reconciled onto the existing `ContractType` enum: PERMANENT (= permanent full-time), FIXED_TERM, PART_TIME (= permanent part-time), INTERN, SUMMER_INTERN, TRAINEE, SECONDMENT, FREELANCER, CONSULTANT, CONTRACTOR, TEMPORARY. Labelled "Employment type". ADR-076.                                                                                                                                                                       |
| D3  | **One working calendar** (core `WorkingSchedule` singleton: ISO weekdays, default Sun–Thu working, 08:00–17:00 Asia/Muscat) plus a core `PublicHoliday` table. EVERY due date, working-day count and notification window reads it. ADR-077.                                                                                                                                                                                                                                                                                                                    |
| D4  | **Statutory parameters and position classifications are core config** (`StatutoryParameter`, `PositionClassification`), effective-dated and verified as in Offboarding §2.10.                                                                                                                                                                                                                                                                                                                                                                                  |
| D5  | **ID documents in the core record supersede Onboarding §17.1** for HR Centre (operator). The JML forms never capture ID numbers or bank details; the checklist still tracks receipt only. ADR-078.                                                                                                                                                                                                                                                                                                                                                             |
| D6  | **One case engine.** `JmlCase` header (type JOIN/MOVE/LEAVE) + one detail table per type; one task engine (template → tasks, owners, due dates from a date basis + offset in calendar or working days); one assignment-rule model (Onboarding's scoped + priority form, optionally limited to case types); one asset/access register (issued at JOIN, returned/revoked at LEAVE); one notification mechanism (core `Notification` extended with `caseId`, `sendAfter`, `dismissedAt` and JML kinds; email through `lib/email.ts` with a queue + log). ADR-079. |
| D7  | **Leavers use the core departure flow.** Login revoked at the last physical working day (summary dismissal: notice start); `applyDeparture` at the last day of service; `Employee.lastWorkingDay` = last day of service. A new core `reverseDeparture` undoes it when a resignation is withdrawn. Closure requires the departure applied. ADR-080.                                                                                                                                                                                                             |
| D8  | **Joiners.** A JOIN case owns a PRE_JOINER `Employee` (created through `lib/people/write.ts` when the draft is first saved, or supplied by Hiring through `openJoinCase`). Day one ("Confirm actual start") flips it to ACTIVE and sets `dateOfJoining`.                                                                                                                                                                                                                                                                                                       |
| D9  | **Movers.** Onboarding's INTERNAL_CHANGE (R1–R10). The new details are applied to the employee when the MOVE case completes, through the existing transfer logic (period split when the person is enrolled in a cycle that year). Before completion nothing on the record has changed, so cancelling needs no revert. R6 ("write immediately") is superseded by the operator's brief.                                                                                                                                                                          |
| D10 | **Archive never deletes** (F1): status ARCHIVED + `archivedAt/By`; the case stays readable and searchable. A discarded DRAFT is soft-deleted (`deletedAt`) together with its pre-joiner.                                                                                                                                                                                                                                                                                                                                                                       |
| D11 | **Word documents** with `docxtemplater` + `pizzip` (default parser only), nine default templates authored from the field lists and committed; HR uploads their real templates through the template screen. ADR-081.                                                                                                                                                                                                                                                                                                                                            |
| D12 | **Permissions** (catalogue module `jml`, all scope-aware: GROUP / COMPANY / DIRECTORATE / DEPARTMENT of the case's employee) and three starter roles HR Manager / Senior HR / Junior HR reproducing the source role behaviour. Out-of-scope case = 404.                                                                                                                                                                                                                                                                                                        |
| D13 | **Line manager** is the core `Employee.managerId` (a picker), not free text. Leave approvals held by "Line Manager" resolve to that employee.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D14 | Settlement money, the leave wage and the exit-interview narrative are **Restricted**: AES-GCM at rest (salary keyring, AAD bound to the case), in SCRUB_FIELDS, the export denylist and the db-sql REDACT list — the three kept in sync by test.                                                                                                                                                                                                                                                                                                               |

## Architecture

```
core (prisma/schema.prisma)
  Employee (+ status PRE_JOINER, employeeCode, positionClassificationId)
  EmployeeCodeSequence · WorkingSchedule · PublicHoliday · StatutoryParameter · PositionClassification
  Notification (+ caseId, sendAfter, dismissedAt, JML kinds)
lib/working-time/**   calendar maths (pure) + loader         lib/statutory/**  effective-dated params
lib/people/employee-code.ts · provisional-id.ts               lib/pms/departure.ts (+ reverseDeparture)

module (jml_* shared, leave_* leaver-only)
  JmlCase ─┬─ JmlJoinDetail (1:1)      JmlTaskTemplate ── JmlTemplateTask
           ├─ JmlMoveDetail (1:1)      JmlTask ── JmlTaskComment
           ├─ LeaveCaseDetail (1:1)    JmlHrAssignmentRule · JmlContractType · JmlEmploymentTypeConfig
           ├─ JmlApproval              JmlEmailLog · JmlEmailTemplateOverride
           ├─ JmlAsset / JmlAccessItem JmlAssetType · JmlAccessChecklistItem · JmlApprovalAuthority
           ├─ JmlGeneratedDocument     JmlDocumentTemplate
           └─ Leave{ExitInterview, Settlement(+Lines), GateRecord, ComplianceIncident}
  LeaveReasonCategory/Code · LeaveDeductionType · LeaveHeadcountSnapshot
lib/jml/**  engine/ (case, tasks, due dates, rules, templates, notifications, email)
            join/ move/ leave/ (type behaviour) · reports/ · documents/
app/api/jml/** · app/[locale]/(dashboard)/jml/** · components/jml/**
app/api/internal/jml-sweep  hourly (CRON_SECRET): email drain + alerts, IT reminders, 08:00 Muscat
                            digests/escalations/reminders/statutory alerts, incident scan,
                            LPWD login revocation, LDS departure, retention
```

Where state lives: all case data in Postgres (audited by the extension; `JmlCase` soft-delete
registered); templates/config in Postgres, seeded idempotently by `prisma/seed-jml.ts`
(production-safe: no people, no cases); permission catalogue in code; generated Word files are
streamed and never stored (metadata only, BR-OFF-027).

## User stories & acceptance criteria

The source artifacts' stories are the contract and are not restated in full; each slice blueprint
lists the stories it delivers. The JML-level stories:

- **US-J1 Joiners.** As HR I draft a joiner, activate onboarding (EMP code, owner, checklist), track
  it to completion and the person becomes ACTIVE on day one — Onboarding US1–US11.
- **US-J2 Movers.** As HR I start an internal change for an employee; when its checklist completes
  the change is applied to the record through the transfer logic — Onboarding R1–R10.
- **US-J3 Leavers.** As HR I run an exit case through the four stages, compliance gates C1–C11,
  approvals, assets/access, settlement and the exit interview, and closing it departs the employee
  — Offboarding US1–US22.
- **US-J4 One engine.** The same task engine, assignment rules, working calendar, notifications
  and permissions serve all three case types.
- AC-J4.1 Every due date and working-day count honours the working schedule AND public holidays.
- AC-J4.2 Every API-only action in the sources has a screen (offboarding F6, onboarding §8.4.6).
- AC-J4.3 A case outside the actor's scope answers 404; a permission missing in scope answers 403.
- AC-J4.4 All seven leave notification kinds and all onboarding email types are produced by the
  sweep or the event that triggers them; windows are evaluated in Asia/Muscat.

## Scenarios

**Happy path (joiner).** Junior HR drafts Aisha (company Rihal) → a PRE_JOINER record exists →
activation allocates EMP0312, assigns the owner from the rule, generates 36 tasks due on working
days → welcome email queued for the next window → on day one HR confirms actual start → Aisha is
ACTIVE, payroll / Day One / headset emails queue → checklist completes → case COMPLETED.

**Happy path (leaver).** Resignation → exit case drafted from the employee record → activated (50
tasks, 26 access items) → dates recalculated once (recalculation notice) → LPWD passes: login
revoked → settlement calculated, approved by the HR Manager and the Operations Director, paid →
LDS passes: departure applied (reports roll up) → C1–C11 satisfied → closed.

**Worst paths.**

- Two activations race for an EMP code → the row lock serialises them; distinct adjacent codes.
- A case-number race → retried, never a 500 (onboarding §8.4.8).
- A Codeline-scoped Junior HR opens a Rihal case by URL → 404; the form's pickers never call an
  admin-only route (§8.4.2, F7).
- A resignation is withdrawn after the departure was applied → cancel generates reversal tasks and
  `reverseDeparture` restores the employee and login; reports moved by the roll-up are listed for
  HR to move back.
- The sweep runs at 09:00 Muscat (05:00 UTC) → the window is evaluated in Muscat time and
  notifications are delivered (F2).
- The settlement is provisional (unverified statutory values) → approval refused naming the keys.
- A manager with more than 200 reports leaves → departure refused with a sentence and surfaced as
  a closure blocker; nothing half-applied.

## Five Pillars

- **Speed:** RSC pages; one grants query per request; lists paginate; the sweep pages its work.
- **Secure:** auth wrapper + zod on every route; scope-aware permissions in the query; Restricted
  money/narrative encrypted, scrubbed and never exported; generated documents never stored.
- **Maintainable:** one engine for three case types; pure functions ported with their tests.
- **Scalable:** every list/report bounded (caps from the sources); bulk task generation in one
  transaction with explicit audit.
- **High-quality:** honest empty/loading/error states, refusal sentences from the services,
  sentence-case copy in `messages/en.json`.

## Delivery slices

1. **S1 Core** — PRE_JOINER, provisional odooId + re-key, employeeCode + sequence, unified
   employment types, working calendar + holidays, statutory parameters, position
   classifications, reason codes, `reverseDeparture`. (Merged first: Hiring depends on it.)
2. **S2 Case engine** — case header, templates, task generation, owners/rules, due dates,
   comments, notifications + email log, config screens.
3. **S3 Joiners** — every onboarding feature, screens, reports, `openJoinCase`.
4. **S4 Movers** — internal changes R1–R10 + transfer application.
5. **S5 Leavers 1** — exit cases, stages, gates C1–C11, approvals + delegates, assets/access.
6. **S6 Leavers 2** — settlement & gratuity, exit interview, documents, departure, historical
   import, reports R1–R8.
7. **S7 Integration** — dashboard, My tasks, employee-record tab.

## Open questions (carried from the sources; defaults applied)

1. Assignment precedence ladder (department > directorate > company) — prototype default, HR to confirm.
2. Which §10.2 contract task is canonical for BR-013 — both names accepted.
3. Prevention-factor list (offboarding OQ9) — derived list kept.
4. Summary-dismissal entitlement factor (O2) and Omanisation target — unseeded; HR enters them.
5. HR must re-upload their real Word templates (the old app's uploads live in its database).
