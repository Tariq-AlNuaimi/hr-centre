# ADR-075 — JML core identity: pre-joiners, provisional Odoo ids, EMP codes

**Status:** 🟢 Accepted — operator brief for the JML module, 2026-10-26 (Tariq Al-Naaimi).
**Date:** 2026-10-27
**Related:** `docs/blueprints/jml.md` D1, D8; ADR-065 (identity), ADR-067 (field encryption).

## Context

HR Onboarding kept people who had not started yet in its own `NewHire` table and issued them an
EMP code at activation; HR Centre has one employee record (`Employee`, keyed on the required,
unique `odooId`) and only ACTIVE / LEAVER. A joiner has no Odoo record yet, and the Hiring module
(built in parallel) must be able to hand an accepted candidate to JML.

## Decision drivers

- One employee record: a joiner must be an `Employee`, not a second person table.
- `odooId` stays THE permanent key and stays required (every Performance query relies on it).
- Salary and ID numbers are AES-GCM envelopes bound to `odooId` (AAD) — changing the id must
  not orphan them.
- BR-003: one EMP sequence across all companies, never reused; BR-021: no activation before HR
  records the cutover.

## Considered options

### Option 1 — PRE_JOINER status + provisional odooId + core EMP code (chosen)

`EmployeeStatus.PRE_JOINER`; a provisional `odooId` `PENDING-<random>` until HR records the real
id through ONE audited operation (`lib/people/odoo-id.ts`) that re-encrypts every value bound to
the old id; `Employee.employeeCode` (unique, nullable) issued from a core `EmployeeCodeSequence`
singleton with `SELECT … FOR UPDATE`.

- Good, because every module sees the joiner as an employee (search, scope, record tab).
- Good, because nothing downstream changes meaning: Performance enrols ACTIVE only.
- Bad, because a provisional id is a value that must be replaced (mitigated: the import names a
  pre-joiner email clash and points HR at the joiner case).

### Option 2 — create the Employee only at actual start

- Good, because no provisional id. Bad, because a JOIN case would have no employee for weeks, so
  scope, search and Hiring's hand-over would all need a second subject type.

### Option 3 — nullable `odooId`

- Bad, because `odooId` is the import's upsert key and the AAD of two encrypted columns; nullable
  would ripple through every Performance query.

## Decision

Option 1. Core People forms can neither create nor leave PRE_JOINER (the joiner case owns the
transition: "Confirm actual start" makes them ACTIVE). The EMP code is distinct from `odooId`;
HR may record the code of an existing employee only below the system range.

## Consequences

- Positive: Hiring can open a joiner case for an employee it created; one subject everywhere.
- Negative: pre-joiners appear in the People directory (filterable, badged "Pre-joiner").
- Mitigations: the import's email-in-use message recognises a pre-joiner and says what to do.

## Migration triggers

Odoo API sync (foundation "later") — the sync becomes the caller of `recordOdooId`.
