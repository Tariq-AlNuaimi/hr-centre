# P3 — one "who is my HR" model: core HR partner coverage (ADR-102)

Scope: lib/core/hr-coverage/**, lib/validations/core/hr-coverage.ts, lib/jml/engine/assignment.ts, lib/hive/hrtag-source.ts, lib/hive/services/reference.ts, lib/nav/tabs.ts, lib/nav/page-gate.ts, lib/prisma/recyclable.ts, lib/prisma/soft-delete-extension.ts, app/api/hr-coverage/route.ts, app/api/hr-coverage/[id]/route.ts, app/[locale]/(dashboard)/admin/settings/hr-coverage/page.tsx, app/[locale]/(dashboard)/jml/settings/rules/page.tsx, components/settings/HrCoverageSettings.tsx, components/settings/HrCoverageDialog.tsx, prisma/migrations/20261031120000_core_hr_coverage/**, tests/integration/hr-coverage.test.ts

Status: operator-approved follow-up to ADR-097 ("Not done here"). Feature parity: Workday's
"HR partner by supervisory organisation" assignment is the pattern; routing outcomes in both
modules must not change.

## Stories and acceptance criteria

- **US-2.1 (employee raising a ticket) routing unchanged.** AC: the same pair answers for
  the same company / words / unit selector as before (company-wide wins; words match
  exactly after folding; a unit selector picks a single pair; ambiguity is reported); a
  soft-deleted row never routes; a row switched off stops routing.
- **US-2.2 (HR, a new joiner / mover / leaver case) owner unchanged.** AC: the most
  specific unit with a live owner and supervisor wins (department, then directorate, then
  company), then priority, then the oldest row; case-type limits apply; inactive rows and
  deleted accounts never own a case; no coverage ⇒ the case is refused as before.
- **US-2.3 (HR admin) one screen.** AC: Admin › Settings › HR coverage lists every row with
  its unit, its ticket pair and words, its case owner and supervisor, case types, priority
  and status; add / edit / remove (soft, restorable). The ticket half needs
  `tickets.configure`, the case half `jml.configure` (both group-wide, as in their
  modules); the screen shows the half you may not change as read-only. The JML rules page
  redirects here; the tickets pairs page links here for coverage.
- **US-2.4 (HR admin) the same rules on save.** AC: a pair row needs the words; both seats
  or neither; seats hold `jml.workTasks` / `jml.supervise` for the unit; case seats only
  on a company, directorate or department; the unit belongs to the chosen company.
- **US-2.5 (everyone) existing data survives.** AC: every ticket coverage row keeps its id
  (table renamed in place); every JML rule is copied with its id; the old JML table stays
  until verified live.

## Worst paths

- A JML-only row has no pair → never reaches ticket routing (pairs read their own rows).
- A ticket-only row has no seats → never owns a case.
- A team row with seats → refused (cases are assigned by company, directorate or
  department; team rows route tickets by the unit selector).
- Someone with only one half's permission edits the other half → 403.

## Architecture

`core_hr_coverage` (model `HrCoverage`; was `hive_hr_tag_coverage`) + `level`, `team_id`,
`priority`, `active`, `case_types`, `owner_user_id`, `supervisor_user_id`; `pairId` optional.
`lib/core/hr-coverage` owns the case resolution and the seat checks; HIVE's
`hrtag-routing.ts` keeps the word-matching rules over the same rows; ticket rotation and
quotas stay HIVE's. JML's rules API keeps its shape (scope, scopeId, juniorHr, seniorHr).

## Evidence

Scratch replay: 9 JML rules (company / directorate / department, priorities, case-type
limits, an inactive rule, a deleted account, a tie broken by age) + 5 ticket rows. Every
placement × case type resolved by the OLD resolver on the legacy table and the NEW one on
the core table: 18 of 18 identical. Ticket routing over the migrated rows: company-wide,
word, alias, selector and deleted-row cases as before.

## Open question for HR

The data is unchanged, so the two halves still say different things: ticket pairs cover
units by name; case owners cover units by rule. HR should confirm, unit by unit, who
actually covers what and fill both halves of each row.
