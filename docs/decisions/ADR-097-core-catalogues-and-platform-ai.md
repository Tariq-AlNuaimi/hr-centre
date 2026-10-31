# ADR-097 — Core grade and competency catalogues; Employee grade linked; platform AI settings

**Status:** Accepted — operator-approved P2 platform roadmap (item 5)
**Date:** 2026-10-29
**Decision owner:** Tariq Al-Naaimi (operator)

## Context

Grades were defined twice — `HiringGrade` (code, band, company) for offers and
`Employee.grade`, a free string — so a hire's grade was not the grade catalogue's, and
two competency libraries were planned. The AI provider, key and budget lived under Hiring
settings although ticket drafting will need them too (audit: `ux/tickets-hiring.md`
P2-4, P2-8; `ux/shell-people.md` R18).

## Decision

1. **Catalogues:** `core_grades` and `core_competencies` (ids kept — requisitions and
   anchors that name them keep resolving), copied from the Hiring tables including
   soft-deleted rows. Hiring's library edits them today; People and Performance read them.
2. **Employee grade:** `Employee.gradeId` (FK, `SET NULL`) links the written grade to the
   catalogue. The migration adds a company grade for every grade an employee holds that
   the catalogue did not know (name = code, no band), so no value is lost and every
   employee with a grade is linked. The string stays the record's value for now (the
   import contract, forms and JML snapshots read it); the link is maintained by a
   **database trigger** on every insert/update of `grade`/`entityId` — so the five
   writers (import, form, joiner, mover, hiring hand-over) cannot drift — and re-derived
   when the catalogue changes (`relinkEmployeeGrades`). The company's own grade wins over
   a group-wide one; matching ignores case and spacing.
3. **Platform AI:** the `ai.*` provider/key/limit settings move from module `hiring` to
   `platform` on the core settings store (the sealed key's context is its key name, so it
   still opens). Edited at Admin › Settings › AI (by `hiring.configure` holders until a
   platform AI permission exists); Hiring reads them. Hiring's scoring weights stay Hiring's.

## Considered options

- **Replace the string with the FK now** (grade picker on the form, import resolving
  codes) — deferred: it changes the people-import contract and four writers at once. The
  trigger gives the catalogue link today with no writer change; dropping the string is a
  later, separate step.
- **App-level linking in each writer** — rejected: five call sites to keep in step, and
  any new writer would forget.
- **Keep AI under Hiring and copy for tickets** — rejected: two keys and two budgets.

## Not done here

- **HR partner coverage** (one model for ticket routing and JML HR assignment) — deferred:
  `HrTagPair/Coverage` routes by pair with rotation and quotas while `JmlHrAssignmentRule`
  assigns one owner per case by rule; unifying them changes routing behaviour both
  modules rely on and needs HR to confirm who covers what. Documented for a follow-up.
  **Done in ADR-102** (one core coverage table, routing outcomes unchanged).
- Performance does not yet reference `core_competencies` (its templates keep their own
  questions); the catalogue is ready for it. **Done in ADR-103** (360 questions name a
  competency), together with dropping `Employee.grade` and its trigger.

The legacy `hiring_grades` / `hiring_competencies` tables are dropped once the new path is
verified live.
