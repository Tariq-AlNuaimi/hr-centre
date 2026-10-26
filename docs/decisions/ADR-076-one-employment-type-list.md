# ADR-076 — One employment-type list

**Status:** 🟢 Accepted — operator brief for the JML module, 2026-10-26.
**Date:** 2026-10-27
**Related:** `docs/blueprints/jml.md` D2.

## Context

Three lists existed: HR Onboarding's `EmploymentType` (9: PERMANENT_FULL_TIME, PART_TIME, INTERN,
SUMMER_INTERN, FREELANCER, CONSULTANT, CONTRACTOR, TEMPORARY, TRAINEE), HR Offboarding's (6:
PERMANENT_FULL_TIME, PERMANENT_PART_TIME, FIXED_TERM, TEMPORARY, CONSULTANT, INTERN) and the
foundation's `ContractType` on `Employee` (5: PERMANENT, FIXED_TERM, INTERN, PART_TIME,
SECONDMENT). The operator asked for ONE list, the union, reconciled with `contractType`.

## Decision

Extend the existing `ContractType` enum (no second field) to the union, reconciled:

| HR Centre value | Onboarding          | Offboarding         | Foundation |
| --------------- | ------------------- | ------------------- | ---------- |
| PERMANENT       | PERMANENT_FULL_TIME | PERMANENT_FULL_TIME | PERMANENT  |
| PART_TIME       | PART_TIME           | PERMANENT_PART_TIME | PART_TIME  |
| FIXED_TERM      | —                   | FIXED_TERM          | FIXED_TERM |
| INTERN          | INTERN              | INTERN              | INTERN     |
| SUMMER_INTERN   | SUMMER_INTERN       | —                   | —          |
| TRAINEE         | TRAINEE             | —                   | —          |
| SECONDMENT      | —                   | —                   | SECONDMENT |
| FREELANCER      | FREELANCER          | —                   | —          |
| CONSULTANT      | CONSULTANT          | CONSULTANT          | —          |
| CONTRACTOR      | CONTRACTOR          | —                   | —          |
| TEMPORARY       | TEMPORARY           | TEMPORARY           | —          |

The field is labelled "Employment type" (labels: Permanent full-time, Part-time, Temporary
employee… — Onboarding's approved wording, §7.4). Offboarding's template scope rule stays
literal: FULL template iff PERMANENT (permanent full-time), LIGHT otherwise (BR-OFF-006).
Onboarding's separate admin `ContractType` table (HR-defined legal contract kinds, seeded empty)
is a different concept and is ported as `JmlContractType`.

## Considered options

1. **Extend `ContractType` (chosen)** — one column, the import and forms pick it up.
2. **A module enum `JmlEmploymentType` beside it** — rejected: two fields that must agree.
3. **An admin table** — rejected: the Offboarding FULL/LIGHT rule and Onboarding change rules
   (R5) key on specific values, so the list must be closed.

## Consequences

Import accepts the new labels; existing rows keep their value (PERMANENT now reads "Permanent
full-time"). An 11th value is a migration, by design (Onboarding §7.4).
