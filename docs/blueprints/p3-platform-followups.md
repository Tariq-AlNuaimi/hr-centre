# P3 platform follow-ups — approvals on the core engine

Scope: lib/core/approvals/**, lib/hiring/requisition-status.ts, lib/hiring/requisition-rules.ts, lib/hiring/requisition-pending.ts, lib/hiring/requisition-views.ts, lib/hiring/requisition-write.ts, lib/hiring/jd.ts, lib/hiring/offer-round.ts, lib/hiring/work-items.ts, lib/hiring/my-hiring.ts, prisma/schema.prisma, prisma/migrations/20261031100000_hiring_approvals_on_core/**, tests/contracts/core-approvals.test.ts, tests/integration/hiring-approvals-engine.test.ts

Status: operator-approved follow-ups to ADR-094 (approvals), ADR-097 (catalogues, HR
coverage) and ADR-095 (email log). Feature parity: n/a — each item consolidates behaviour
that already exists; nothing a user relies on may change.

## 1. Requisition approval and JD sign-off on the core engine (ADR-094)

### Stories and acceptance criteria

- **US-1.1 (approver) requisitions work exactly as before.** AC: two steps, HR Manager then
  Operations Director; never the submitter; one person never signs both steps (not
  admin-overridable); only a routed approver or a hiring admin; the four sentences and their
  order are unchanged (parity test); a reason is required (unchanged route schema); the
  last signature opens the requisition and writes its history row in the same
  transaction; an intermediate signature answers `{ signed, next }` as before.
- **US-1.2 (approver) declining.** AC: a routed approver's "Rejected — …" / "Sent back — …"
  closes the round as that decision; a manager withdrawing cancels it; any move that was
  allowed before is still allowed.
- **US-1.3 (requester) resubmitting starts a fresh round** and the earlier round keeps its
  decisions (history).
- **US-1.4 (signer) JD sign-off works exactly as before.** AC: two named slots on the
  CURRENT version; the hiring-manager slot is exactly the hiring manager; the HR slot is HR
  (or a hiring admin), never the hiring manager, never the drafter, never a person who
  signed the other slot; every jd-rules sentence unchanged; a signer may still request
  changes; a request for changes bumps the version; editing the JD under sign-off voids
  the round; the history lists signatures and send-backs across versions.
- **US-1.5 (everyone) existing rounds survive.** AC: pending requisitions and JDs keep
  their signatures; decided ones keep their history (scratch replay with fixture rows).
- **US-1.6 (approver going on leave)** a delegate may sign a requisition step for a holder,
  held to the holder's bans (as offers, ADR-094).

### Worst paths

- Pending requisition with no copied round → "Can't verify who submitted …" (re-submit),
  as before for a submission with no recorded submitter.
- Two people signing the same JD at the same moment → the second gets "changed since you
  loaded it — reload and retry" (before, both committed and a reconciler closed the race).
- The approval config changes while a requisition is pending → the round keeps the steps
  it was submitted with.

### Architecture

Subjects `hiring.requisition` (round per submission) and `hiring.jd` (round per JD version,
`core_approval_requests.subject_version`). Engine additions: `slot` on decisions
(unique per step), one APPROVAL per person per step (a signer may still decline), and
`submitterMayDecide` for a module that owns a narrower submitter rule. Migration
`20261031100000_hiring_approvals_on_core` adds the columns and copies every round; the
legacy tables stay until the new path is verified live.

### Evidence

Scratch replay (fixture: 5 requisitions — pending with HR signed, approved, rejected,
sent back then resubmitted, withdrawn; 2 JDs — v1 sent back + v2 approved, v1 awaiting
with the hiring manager signed) → 9 rounds with the expected statuses and steps,
10 decisions (including the two declines) — recorded in the PR.
