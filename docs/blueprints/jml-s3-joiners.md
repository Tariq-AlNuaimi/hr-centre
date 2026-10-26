# Blueprint — JML slice S3: joiners

Scope: lib/jml/**, lib/validations/jml/**, app/api/jml/**, app/[locale]/(dashboard)/jml/**, components/jml/**, lib/people/provisional-id.ts, lib/pms/import/run.ts, lib/prisma/recyclable.ts, lib/env.ts, prisma/schema.prisma, prisma/seed-jml.ts, prisma/seed-jml-templates.ts, tests/contracts/jml-joiners.test.ts

Status: part of `docs/blueprints/jml.md` (slice 3). Decisions D8 (joiners own a PRE_JOINER
employee), D12 (permissions); ADR-082.

## What this slice delivers (HR Onboarding US1–US11, §8–§17)

- **Schema:** `JmlJoinDetail` (1:1 with a JOIN case) — only what the core record does not hold:
  contract type, planned/actual start, contract dates, probation, payroll, client-assigned role,
  introduction, hobbies, the three IT answers, IT readiness (now written — 8.4.5), IT intake
  outcome, and the idempotency key of the module that opened the case (`sourceRef`, Hiring).
- **Drafts:** saving a draft creates the PRE_JOINER `Employee` through `lib/people/write.ts`
  (provisional Odoo id, placeholder work email until issued, salary encrypted) and a DRAFT JOIN
  case with a `DRAFT-…` reference. Discard = soft delete of both (bin GC order fixed so the case
  goes first).
- **Activation** in Onboarding's load-bearing order — readiness (all blockers at once),
  directorate rule, duplicate personal email (override with a reason by `jml.supervise`), then
  one transaction: owner rule → template (employment-type suggestion first — 8.4.10) → tasks on
  the working calendar → EMP code LAST → `ONB-YYYY-NNNN` (retried on a race — 8.4.8). After
  commit: welcome email, PRO visa notice, IT intake submission (8.4.5).
- **Case actions** (any type where they apply): cancel, archive (also of cancelled cases —
  8.4.6), reassign owner with open tasks following (8.4.7), legal hold, record Odoo id;
  joiner-only: confirm actual start (employee → ACTIVE, `dateOfJoining`, probation end, login
  from the work email), change start date (tasks recomputed on the calendar; IT/PRO/manager
  told — 8.4.11 closes the PATCH bypass), IT readiness, submit to IT, send the welcome-review
  email by hand.
- **Hiring hand-off:** `openJoinCase({employeeId, sourceRef, …})` opens an idempotent DRAFT for an
  existing PRE_JOINER; `withdrawJoinCase(sourceRef, …)` discards or cancels it.
- **Sweep steps:** IT readiness reminders (≤ 2 working days, once a day), 08:00 Muscat overdue
  digests to each TASK owner (8.4.7), daily retention at 03:00 Muscat.
- **Retention:** refuses without `JML_RETENTION_DAYS`; anonymise (default) or purge. A joiner who
  started stays an employee — only the case's free text, messages, notifications and the audit
  JSON of those rows are erased; a never-started pre-joiner is erased completely (8.4.3).
- **Screens:** Cases (all types, export), Joiners (list, add, edit + activation panel), Case
  (Checklist with complete/confirmation trio, N/A, delay, reopen, due date, owner, comments,
  manual task; Overview; Emails & notifications with retry and welcome-review send; Activity from
  the audit trail), Joining calendar (month/week/list, totals, export), Statutory watch, Reports
  (the eight §13.1 reports, filters, salary opt-in per person, Excel), Data retention preview.
  Reports are a permission checked by page and route (8.4.1).
- **Seed:** the §10.2 36-task starter template (payroll conditional on Payroll Applicable,
  visa for non-Omani, MOL for Omani — BR-005/006 fixed, 8.4.12).

## Scenarios

- Happy: draft → activate (EMP0311, owner from the rule, 36 tasks) → start date moved one week
  (tasks recomputed, line manager emailed) → actual start confirmed → employee ACTIVE, login when
  the work email is on file → checklist completes → case COMPLETED.
- Worst: a Codeline-scoped officer opens a Rihal joiner → 404; a duplicate personal email blocks
  a junior and needs a reason from a senior; activation with no rule/template/cutover is refused
  with the sentence and leaves no code, case or task; PATCHing the start of an active case is
  refused (use Change start date); the IT intake is off → the case says so instead of a green
  toast.

## Open questions (defaults applied)

1. Work email: the joiner keeps a `@pre-joiner.invalid` placeholder until HR records the issued
   address; no login exists before that.
2. A cancelled onboarding leaves its employee as PRE_JOINER (visible on People with that badge)
   until retention erases it; a new JOIN case can be opened for the same person.
