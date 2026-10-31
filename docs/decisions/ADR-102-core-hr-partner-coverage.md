# ADR-102 — One "who is my HR" model: core HR partner coverage

**Status:** Accepted — operator-approved follow-up to ADR-097 ("Not done here")
**Date:** 2026-10-31
**Decision owner:** Tariq Al-Naaimi (operator)

## Context

Two modules answered "who is this person's HR?" from two tables: HR tickets routed by
`HrTagCoverage` (a pair per unit, matched by the words an employee uses, a company-wide
flag or a unit link; rotation and quotas on top), and JML assigned a case owner and
supervisor by `JmlHrAssignmentRule` (most specific unit wins, then priority, then the oldest
rule; limited by case type). HR edited "who covers what" in two places that drifted
(audit: `ux/tickets-hiring.md` P2-4; ADR-097 deferred it because unifying must not change
routing outcomes either module relies on).

## Decision drivers

- One row per "this unit is covered by these HR people", edited on one screen.
- No routing outcome may change: same pair for the same ticket, same owner for the same case.
- Ticket rotation and quotas are ticket behaviour; they stay in HIVE.

## Considered options

1. **One core table, two halves (chosen).** `hive_hr_tag_coverage` becomes `core_hr_coverage`
   in place (every row and id kept) with `level`, `team_id`, `priority`, `active`,
   `case_types`, `owner_user_id`, `supervisor_user_id`; `pairId` becomes optional. JML's rules
   are copied in with their ids. A row with a pair routes tickets; a row with an owner and
   supervisor assigns cases; one row may do both. Each module reads its half with its own,
   unchanged rules (HIVE `hrtag-routing.ts`; core `resolveCaseOwner`, which is JML's ladder).
2. **A union read model over the two tables.** Rejected: one screen, two sources of truth.
3. **Derive ticket pairs from case owners (or the reverse).** Rejected: changes outcomes — a
   pair is two equal contacts, a case has an owner and a supervisor, and today they differ.
4. **An HRIS HR-partner field (Workday, HiBob).** Rejected: HR Centre is the system of record.

## Decision

Option 1. Admin › Settings › HR coverage lists and edits every row; the ticket half needs
`tickets.configure`, the case half `jml.configure` (both group-wide, as in their modules), and
the unit / on-off switch needs every half the row has. The JML rules page redirects there and
the tickets pairs page links there. JML's rules API keeps its shape. Case seats are refused on
a team row (JML's ladder has no team rung); team rows route tickets by the unit selector. A
row switched off stops routing tickets too (new — every migrated row is on).

## Consequences

- Parity: scratch replay compared the old resolver on the legacy table with the new one on
  the core table for every placement × case type — identical (blueprint
  `p3-hr-coverage.md`). Contract tests keep the original JML cases.
- The data still says what it said: HR must confirm unit by unit who covers what and fill
  both halves of each row (handover note).
- `jml_hr_assignment_rules` is dropped once the core path is verified live.
