# Blueprint — JML slice S4: movers

Scope: lib/jml/**, lib/validations/jml/**, app/api/jml/**, app/[locale]/(dashboard)/jml/**, components/jml/**, lib/pms/transfer-apply.ts, app/api/transfers/route.ts, prisma/schema.prisma, prisma/seed-jml.ts, prisma/seed-jml-templates.ts, tests/contracts/jml-movers.test.ts

Status: part of `docs/blueprints/jml.md` (slice 4). Decision D9 (a MOVE applies when it
completes, through the existing transfer logic); ADR-079 (one engine), ADR-082.

## What this slice delivers (HR Onboarding R1–R10)

- **Schema:** `JmlMoveDetail` (1:1 with a MOVE case): change type, effective date, previous/new
  snapshots of the changed fields with their labels, and when/how the change was applied.
- **Rules (pure, tested):** eligibility (an ACTIVE employee — a pre-joiner is corrected, a leaver
  is gone), the overlay (`undefined` keeps, `null` clears, a new department drops the old team),
  the change-type rules (internship → training forces TRAINEE; → employment needs a non-intern,
  non-trainee type; a transfer needs another department and keeps the type), "nothing would
  change", one ACTIVE change at a time. Salary is never part of a change (R10 — the boundary
  refuses the key).
- **Start a change:** owner rule, template (by change type) and task conditions all read the NEW
  position; tasks are due from the effective date on the working calendar; `CHG-YYYY-NNNN`.
  The actor needs `jml.manageMovers` for both the current and the new position.
- **Apply on completion (D9; supersedes R6):** when the checklist completes, in the same
  transaction, the employee record changes. A company/department change goes through the §12.3
  performance split (`lib/pms/transfer-apply.ts`, extracted from `POST /api/transfers`, which now
  calls it too) when the employee is enrolled in that year's cycle and the year is not already
  split; otherwise the placement simply moves and the case records why. A contract-type change
  updates the joiner details when the employee has them. Cancelling needs no revert.
- **Visibility:** an open mover's case is also visible from the position they are moving into
  (its owner is resolved there).
- **Existing employees:** HR records the EMP code of an existing employee (R2: free, below the
  system range, never changes).
- **Screens:** Movers (the case list fixed to MOVE + Start a change), Start an internal change
  (employee picker, current details, EMP code, change form with per-type hints, change history),
  the case Overview shows Before/After and whether it is applied.
- **Seed:** the four internal-change starter templates, one per change type, created only when
  no template of that type exists.

## Scenarios

- Happy: a department transfer effective 1 December → seven tasks → the last mandatory task
  completes → the employee is in the new department with the new title, the performance year is
  split when enrolled, and the case says which happened.
- Worst: a second change while one is open → 409 naming the open case; a transfer into a
  department of another company → refused at start; the department moved to another company
  before completion → completing the last task is refused with the sentence (nothing
  half-applied); a pre-joiner → "has not started yet".
