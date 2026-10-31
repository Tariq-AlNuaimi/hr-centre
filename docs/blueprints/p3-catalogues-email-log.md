# P3 — catalogue-only grades, shared competencies in Performance, the email log (ADR-103)

Scope: lib/core/catalogue/grades.ts, lib/people/write.ts, lib/people/service.ts, lib/pms/import/**, lib/core/employee-select.ts, lib/jml/leave/draft.ts, lib/jml/leave/import.ts, lib/jml/reports/leave/attrition.ts, lib/hive/services/ticket-context.ts, lib/hiring/library.ts, lib/validations/three-sixty.ts, lib/core/email/log.ts, lib/validations/core/email-log.ts, lib/nav/config.ts, lib/nav/page-gate.ts, app/api/org/grades/route.ts, app/api/competencies/route.ts, app/api/three-sixty/route.ts, app/api/email-log/route.ts, app/api/email-log/[id]/resend/route.ts, app/[locale]/(dashboard)/admin/email-log/page.tsx, components/settings/EmailLogAdmin.tsx, components/people/RecordFields.tsx, components/pms/ThreeSixtySetup.tsx, prisma/schema.prisma, prisma/migrations/20261031140000_core_catalogues_only/**, tests/contracts/core-catalogue-grades.test.ts, tests/integration/core-catalogues.test.ts

Status: operator-approved follow-up to ADR-097 and ADR-095. Feature parity: n/a — clean-up of
existing data paths plus one admin list (the pattern of a provider's activity log).

## Stories and acceptance criteria

- **US-3.1 (HR importing people) grades are catalogue codes.** AC: the Grade column takes a
  code of the company's grades or the group-wide ones (case and spacing ignored); an unknown
  code is a row issue that names the accepted codes and nothing is written for that row; a
  blank cell clears the grade; no Grade column leaves it alone; a re-import with the same
  code is not a change.
- **US-3.2 (HR editing a record) the form picks from the catalogue.** AC: the grade is a
  picker of the employee's company's grades (and group-wide ones); an unknown code posted
  directly is refused (400) with the same sentence; readers (record, ticket rail, exit
  snapshot, attrition by grade) show the catalogue code.
- **US-3.3 (everyone) no grade is lost.** AC: every written grade is linked before the column
  is dropped (migration refuses otherwise); the trigger and its functions are gone.
- **US-3.4 (HR setting up a 360) competencies are shared.** AC: a scored question may name a
  competency from the shared catalogue; an unknown id is refused; scoring is unchanged.
- **US-3.5 (platform admin) one email log.** AC: Admin › Logs › Email log lists every
  module's emails newest first, 50 a page, filtered by module, status and date range;
  metadata only; a failed / cancelled / stuck JML email can be resent once (a new queued row
  linked to it); other modules' rows say they send once; non-admins get 404 / 403.

## Worst paths

- A grade code that exists only in another company → refused (company first, then group).
- A catalogue grade moved to another company while others hold it → refused (409).
- Resending a sent email, or one already resent → 409 with the reason.

## Evidence

Scratch replay of `20261031140000_core_catalogues_only` with fixture employees (linked,
group-wide with spacing, unknown code, a grade removed since, no grade) → every value kept
and linked (two new company grades), column and trigger gone, a late JML rule swept into
core coverage, the legacy approval tables dropped.
