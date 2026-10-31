# ADR-103 — An employee's grade is a catalogue row; Performance names shared competencies; one email log screen

**Status:** Accepted — operator-approved follow-up to ADR-097 and ADR-095
**Date:** 2026-10-31
**Decision owner:** Tariq Al-Naaimi (operator)

## Context

ADR-097 linked `Employee.grade` (free text) to the core grade catalogue with a database
trigger and kept the string as the record's value, deferring "replace the string with the FK"
because it changed the import contract and the writers. ADR-097 also left Performance without
a reference to the shared competency catalogue, and ADR-095 deferred an admin page for the
cross-module email log.

## Decision

1. **Grades.** `employees.grade` and the `employees_link_grade` trigger (with its two
   functions) are dropped; `Employee.gradeId` is the grade. Writers still hand over a grade
   CODE — the people import's Grade column and the employee form (now a picker over the
   company's grades and the group-wide ones) — and resolve it in
   `lib/core/catalogue/grades.ts`: the company's own grade first, then a group-wide one; case
   and spacing ignored. An unknown code is refused with a sentence naming the accepted codes
   (import: a row issue `grade_unknown`; form: 400 `grade: …`). Readers show the catalogue
   code. A grade cannot move to another company while people elsewhere hold it.
   - Migration: every employee whose written grade had no live link (a removed grade, or one
     never matched) gets a company grade (name = code, no band) and is linked; the migration
     refuses to drop the column if any value would still be unlinked.
   - Moving an employee to another company keeps their grade row (no silent re-mapping).
2. **Competencies.** A Performance 360 scored question may name the competency it assesses
   (`template_questions.competency_id`, SET NULL) from the shared core catalogue; the setup
   screen offers the catalogue; scoring is unchanged. That is the only place Performance
   uses competencies today.
3. **Email log.** Admin › Logs › Email log lists every module's emails (module, type,
   recipient, subject, status, failure reason — metadata only, bodies are never stored),
   filtered by module, status and date, bounded and paged; platform administrators only. A
   failed / cancelled / stuck JML email can be resent (JML's queue: a new queued row linked to
   the original); other modules send once and say so.
4. **Legacy tables dropped** now that the core paths are verified live:
   `jml_hr_assignment_rules` (after an idempotent sweep into `core_hr_coverage`), and
   `hiring_requisition_approvals` / `hiring_jd_signoffs` (only when every row is represented
   in the core engine; otherwise kept and a notice raised).

## Considered options

- **Keep the trigger and the string** — rejected: two values for one fact, and the import
  accepted grades the catalogue did not know.
- **Import accepts unknown codes and creates them** — rejected: a typo becomes a grade; HR
  curates the catalogue in Hiring › Settings › Library.
- **A separate Performance competency library** — rejected (ADR-097): one framework.
- **An external email service's log (Postmark, SendGrid activity)** — rejected (ADR-095):
  SMTP is the transport and the log lives in our database.
