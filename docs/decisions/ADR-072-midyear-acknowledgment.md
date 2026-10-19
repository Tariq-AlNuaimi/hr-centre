# ADR-072 — The employee acknowledges a mid-year change, and the re-sign policy is retired

**Status:** Accepted
**Date:** 2026-10-19
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** Claude (implementation, operator-directed)

## Context

UAT Scenario C changed §6.2's mid-year flow. Until now a manager's change request went **straight
to HR**: the employee was not involved, had no mid-year screen, and learned that their goals had
moved when the year-end assessment was measured against a set they had never seen change.

The new flow is manager → **employee acknowledges** → HR decides with that acknowledgment visible,
with a hard consequence for silence and a logged exception for HR.

This lands on top of an existing mechanism that answered the _same_ specification gap a different
way. `docs/verification/OPEN-QUESTIONS-FOR-RIHAL.md` question 1 asked whether anyone signs again
after HR approves a mid-year change. Because the build could not answer it for Rihal, ADR-057's
cycle-policy work added a per-cycle column, `PerformanceCycle.requireResignAfterChange`, defaulting
to the build's existing behaviour (no re-sign) and letting HR choose the other reading per cycle.
When set, the decide route cleared the goal-setting signatures in the same transaction as the edits.

Rihal has now answered — with a third option neither branch anticipated.

## Decision drivers

- **The question the policy toggled has been answered.** A switch offering a choice that is no
  longer open is not configuration; it is a trap.
- **A toggle that changes nothing is a dead control** (`docs/rules/design.md`), and dead controls
  are how a screen stops being believed.
- **Finished years must keep the rules they were judged by** — the reason these columns live on the
  cycle rather than in a global settings row (ADR-057).
- **"No acknowledgment, no change" has to bite**, or it is advice.
- **Nothing may depend on a cron for correctness.**

## Considered options

### Option 1 — Acknowledgment replaces the re-sign question; retire the policy (chosen)

Acknowledgment becomes the unconditional §6.2 flow. `requireResignAfterChange` stops being read,
disappears from `CyclePolicy`, from `CYCLE_POLICY_SELECT`, from the cycle-policy input schema and
from HR's form. **The database column stays.**

- Good, because consent now happens _before_ the decision, which is where the spec gap actually
  was: a signature collected after approval certifies a change already in force.
- Good, because the column surviving keeps the record of what a finished cycle was run under, which
  is the whole point of policy-on-the-cycle. Dropping it would destroy that record to save a column.
- Good, because HR is no longer offered a switch that does nothing.
- Bad, because a column nothing reads invites a later "unused — remove it" cleanup. Mitigated by
  the schema comment naming this ADR, and by the contract test asserting the field is absent from
  the policy surface.

### Option 2 — Keep the policy live, as an independent post-approval re-sign

Treat acknowledgment (before) and re-signature (after) as orthogonal, so a cycle could demand both.

- Good, because it is additive and removes nothing.
- Bad, because nobody asked for both, and the combination has no defined deadline — §5.4's hard
  locks would then apply to a step the specification does not have. That was the original reason
  for answering "no re-sign", and it has not stopped being true.
- Bad, because it keeps a toggle alive on the strength of a hypothetical.

### Option 3 — Drop the column outright

- Good, because nothing is left behind.
- Bad, because `vercel.json` runs `prisma migrate deploy` on every build and `docs/rules/prisma.md`
  is explicit: never drop a column the running version still reads. A deploy is not atomic across
  instances.
- Bad, because it erases what past cycles were run under.

## Decision

**Option 1.** Acknowledgment is the §6.2 flow; `requireResignAfterChange` is retired, its column
kept and marked.

Two sub-decisions worth recording, because both are readings the specification text leaves open:

1. **HR's override expires with the stage.** The spec grants HR an override "with a mandatory
   reason" and separately says that if the deadline passes without acknowledgment the request locks
   and the KPI stays unchanged, deadlines remaining hard locks. Read as surviving the deadline, the
   override would make "no acknowledgment, no change" advice and would let a change be forced
   through by waiting — the thing the clause rules out for the manager. So the exception serves the
   case it was written for (an employee unreachable **within** the window) and expires with it.
   **If Rihal meant otherwise, `approvalAcknowledgmentReason` is the one function to change.**
2. **The lock is derived, not merely swept.** A deadline passing is the absence of an action, so no
   writer runs at that instant. `effectiveChangeRequestStatus` computes the verdict from the clock
   on every read; `cycle-sweep` materialises it afterwards for §6.3's history. Derivation is the
   guarantee, the sweep is the record — a sweep that never runs costs a history row, never a
   wrongly-approved KPI.

   **Known asymmetry, not yet resolved — HR extending a deadline (§5.5).** "The sweep is only a
   record" is not quite true, because the row it writes is terminal. If HR extends the mid-year
   deadline _before_ the sweep runs, the derived status reverts to `PENDING` and the employee can
   still acknowledge; if HR extends it _after_, the row is already `NOT_ACKNOWLEDGED` and the
   manager must re-raise. Same HR action, two outcomes, decided by cron timing — which is the one
   property a deadline rule should not have. Raised by the post-push breadth review.

   Both repairs are small and they point in opposite directions, so this is Rihal's call rather
   than the build's: either (a) the stage-update route reopens `NOT_ACKNOWLEDGED` requests whose
   deadline now lies in the future, audited, which makes the behaviour purely deadline-driven; or
   (b) `NOT_ACKNOWLEDGED` is confirmed as genuinely terminal, the extension form says so, and a
   manager re-raises. **Flagged to the operator, deliberately not chosen here** — (a) revives a
   state this ADR called terminal, and (b) leaves §5.5's remedy partly ineffective. Until it is
   decided, HR should extend a mid-year deadline before the overnight sweep rather than after.

## Consequences

- §6.2's open question is **closed**; `OPEN-QUESTIONS-FOR-RIHAL.md` and `SPEC-CONFORMANCE.md` say so.
- Two cycle policies remain configurable (§7.1's divergence reason, §8.7's rounding). The mechanism
  ADR-057 built is unchanged; one of its three questions simply has an answer now.
- `SignOff.kpiSetHash` keeps its job: it still shows that a signature predates the current set,
  which is what made "no re-sign" honest and remains true.
- A cycle created before this change keeps its stored `require_resign_after_change` value as a
  historical fact. No backfill, and nothing reads it.
