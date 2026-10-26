# Blueprint — JML slice S1: core changes

Scope: lib/working-time/**, lib/statutory/**, lib/people/employee-code.ts, lib/people/provisional-id.ts, lib/people/odoo-id.ts, lib/pms/departure.ts, lib/pms/import/**, lib/validations/people.ts, lib/validations/employee.ts, app/api/employees/**, app/[locale]/(dashboard)/people/**, components/pms/EmployeeColumns.tsx, prisma/schema.prisma, prisma/seed-jml.ts, prisma/seed-jml-data.ts, prisma/seed.ts

Status: part of `docs/blueprints/jml.md` (slice 1, "merge FIRST and fast" — the Hiring module
depends on PRE_JOINER). Decisions D1–D5; ADR-075…078.

## What this slice delivers

- `EmployeeStatus.PRE_JOINER`; core People forms can neither create nor leave it (409 sentence).
- Provisional Odoo ids `PENDING-<random>` (`lib/people/provisional-id.ts`, pure) and
  `recordOdooId` (`lib/people/odoo-id.ts`): one audited transaction that re-encrypts salary and
  ID numbers under the new id. The import names a pre-joiner email clash and says what to do.
- `Employee.employeeCode` + `EmployeeCodeSequence` (configure / allocate under row lock /
  record an existing employee's code below the system range) — Onboarding BR-003/BR-021.
- One employment-type list (ADR-076): `ContractType` extended to 11 values, labels and import
  aliases; label "Employment type".
- Core `WorkingSchedule` + `PublicHoliday` and `lib/working-time` (both sources' semantics,
  holidays, Muscat window — F2 fixed in the maths).
- Core `StatutoryParameter` (+ `lib/statutory/parameters.ts`, verbatim port) and
  `PositionClassification` (+ `Employee.positionClassificationId`).
- Leave reason taxonomy tables (7 categories / 35 codes), seeded.
- `reverseDeparture` beside `applyDeparture` (status, login restore, open roll-ups listed).
- `prisma/seed-jml.ts`: statutory parameters (7, unverified) and the taxonomy, idempotent.

Screens for this configuration arrive with S2's configuration area; this slice is the data and
the maths every later slice uses.

## Acceptance (contract tests: tests/contracts/jml-core.test.ts)

- AC-S1.1 Default week Sun–Thu; a holiday is a non-working day for every calculation.
- AC-S1.2 Working-day offsets snap forward at 0; calendar offsets roll forward (also negative).
- AC-S1.3 The window is Muscat time: 05:00 UTC Sunday is inside; 18:00 Muscat opens next 08:00.
- AC-S1.4 Statutory rows resolve half-open, latest wins, missing → 422; 7 seeded unverified; O2 absent.
- AC-S1.5 EMP codes format/parse strictly; provisional ids are namespaced.
- AC-S1.6 `ContractType` equals the union list; PRE_JOINER not settable through People forms.

## Scenarios

- Happy: a deploy runs the seed twice → 7 parameters and 35 codes, no duplicates, verified
  rows untouched.
- Worst: HR records an Odoo id while the ID key is missing → refused, nothing changed (the ID
  numbers would otherwise become unreadable).
- Worst: two first-time cutovers race → the loser gets "configured by someone else a moment ago".
