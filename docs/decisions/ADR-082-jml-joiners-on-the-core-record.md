# ADR-082 — Joiners live on the core employee record

**Status:** Accepted (operator brief for the JML module, 2026-10-26)
**Related:** `docs/blueprints/jml.md` D1, D8; `docs/blueprints/jml-s3-joiners.md`; ADR-075, ADR-078.

## Context

HR Onboarding kept the joiner in its own `NewHire` table and never touched an employee record.
HR Centre has one employee record (`Employee`) that every module reads. The brief: a JOIN case
creates or links a PRE_JOINER `Employee` through the one writer, and day one flips it to ACTIVE.

## Decision

1. **The draft is a real employee row.** Saving a joiner draft creates a PRE_JOINER `Employee`
   (provisional `PENDING-…` Odoo id — ADR-075) and a DRAFT JOIN case. Because the core row
   requires a company and (except C-Level) a department, a draft needs those too — Onboarding
   accepted a name alone. Everything else stays optional until activation.
2. **Work email.** `Employee.email` is unique and required; until IT issues the address the row
   holds `pending-…@pre-joiner.invalid` (RFC 2606 reserved — undeliverable). Login provisioning
   refuses PRE_JOINER rows and placeholder addresses; the login is created on day one, or when
   the address is recorded on an active joiner.
3. **Joiner-only facts** go to `JmlJoinDetail`; personal email, phone and nationality go to the
   core record's personal fields. JML screens show them to holders of the JML case permissions
   (as Onboarding showed them to all HR) — the core `people.viewPersonal` gate is unchanged
   elsewhere. Salary follows `people.viewSalary` in scope.
4. **Day one** (Confirm actual start) sets `status = ACTIVE`, `dateOfJoining` (until then the
   planned start), `probationEndDate` from the probation months, and the login.
5. **Cancellation keeps the row.** A cancelled onboarding's employee stays PRE_JOINER (a new
   JOIN case may be opened for them); retention later erases a never-started person completely.
   A discarded draft is soft-deleted together with its pre-joiner, and the recycling bin now
   purges `JmlCase` before `Employee` so the RESTRICT foreign key cannot stall the daily GC.
6. **Retention erases case data, not employees.** For a joiner who started, only the onboarding
   case's own free text, messages, notifications and the audit JSON of those rows are erased.

## Consequences

- People lists show pre-joiners (badge "Pre-joiner"); Performance ignores them (not ACTIVE).
- Hiring creates the PRE_JOINER and calls `openJoinCase`; HR completes the draft and activates.
- A draft cannot be saved without a department — the form says so.
