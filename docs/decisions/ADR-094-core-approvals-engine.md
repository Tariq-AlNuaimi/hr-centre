# ADR-094 — One approvals engine: rounds, steps, decisions and delegation in core

**Status:** Accepted — operator-approved P2 platform roadmap (item 1)
**Date:** 2026-10-29
**Decision owner:** Tariq Al-Naaimi (operator)

## Context

Five approval shapes (`HiringRequisitionApproval`, `HiringOfferApproval`,
`HiringJdSignoff`, `JmlApproval` + `JmlApprovalAuthority`, the ticket answer approval
columns, plus Performance `SignOff` / `KpiChangeRequest`), each with its own copy of
"who may decide", no shared delegation and no single inbox (audit:
`ux/tickets-hiring.md` §2C-1, P2-1; `ux/performance-jml.md` P2-7).

## Decision drivers

- One implementation of the rules that keep approvals honest: empty-holder refusal,
  the self-approval ban, one person one step, two-holder steps, audit.
- Role-holder resolution stays with the module's RBAC permissions (scope-aware).
- Migrating a flow must not change the rules its users rely on.

## Considered options

### Option 1 — core engine tables + rules, module keeps its chain and holders (chosen)

`core_approval_requests` (one per ROUND of a subject), `core_approval_steps`
(sequence, role key, label, `required_approvals`, status), `core_approval_decisions`
(decider, `on_behalf_of_id` for delegates, `via_proxy` for module admins, action,
comment) and `core_approval_delegations`. `lib/core/approvals/rules.ts` is pure
(current step, refusal codes, outcomes, vacant steps); `store.ts` opens and cancels
rounds and decides under a row lock, handing the outcome to the module's callback in
the same audited transaction. Modules turn refusal codes into their own sentences.

- Good, because the rules exist once and are tested once.
- Good, because history is kept: a send-back closes a round instead of deleting decisions.
- Bad, because each module still computes its chain and holders (by design — their
  rules differ).

### Option 2 — a workflow engine (Camunda, Temporal, n8n)

- Bad, because a runtime and a modelling language for chains of one to four steps.

### Option 3 — keep module tables, add only a fan-in inbox

- Bad, because delegation, two-holder steps and SoD would still be re-implemented per module.

## Decision

Option 1. **Migrated first: Hiring offers** — every round is copied (pending offers keep
their chain and decisions; decided offers keep their history), submit/resubmit open a
round, leaving approval cancels it, decisions go through `decide`. Sentences and their
order are unchanged (parity test). New: a delegate may decide for a holder.

**Migrated in the follow-up (2026-10-31, migration `hiring_approvals_on_core`):**

- _Hiring requisitions_ — subject `hiring.requisition`. Every move INTO
  PENDING_APPROVAL opens a round whose steps are the chain at that moment (HR Manager,
  then Operations Director); a sign-off is an engine decision (the last one moves the
  requisition to OPEN and writes its history row in the same transaction); a routed
  approver's "Rejected — …" / "Sent back — …" is that decision on the current step; any
  other move out of PENDING_APPROVAL (a withdrawal, archiving, or a decline the engine
  would not record as this person's decision) cancels the round — the move itself is
  allowed exactly as before. The status history keeps every move and its reason. The
  four sentences and their order are pinned (`requisitionRefusalMessage`, parity test).
  The "chain changed while pending" refusal is gone: the round's steps are the snapshot
  taken at submission, so a configuration change cannot rewrite a round under way.
- _JD sign-off_ — subject `hiring.jd`, one round per JD version (`subject_version`):
  ONE step needing two different signatories; each signature is a decision naming its
  slot (`slot` = HIRING_MANAGER / HR, unique per step). Hiring's slot rules and
  sentences (`jd-rules.ts`) run first; the engine is told the module owns the drafter
  rule (`submitterMayDecide` — the drafter may sign the hiring-manager slot, never the
  HR one). A request for changes is a send-back (the version bumps); editing the JD
  under sign-off cancels the round. Two concurrent signatures no longer both commit and
  get reconciled afterwards — the second reloads (`CHANGED`). JD sign-off takes no
  delegation (the hiring-manager slot is exactly the requisition's hiring manager).
- Engine changes for these: `core_approval_requests.subject_version`,
  `core_approval_decisions.slot`; the one-decision-per-person rule is now one
  APPROVAL per person per step — a person who signed a two-signatory step may still
  send it back (`(step_id, decider_id, action)` unique), as JD signers always could.
- Requisition delegation is new, as for offers: a delegate may sign for a holder and is
  held to the holder's bans.
- Every existing round was copied (pending ones keep their signatures; decided ones
  keep their history), verified by replaying the migration on a scratch database with
  fixture rows for every case. `hiring_requisition_approvals` and `hiring_jd_signoffs`
  are dropped once the new path is verified live.

**Not migrated, and why:**

- _JML approvals_ record a decision a holder made elsewhere (the holder may have no login;
  HR record it), so the decider is not the approver — the engine's decider rule does not
  fit without changing JML's rule. Kept; listed in the inbox. `JmlApprovalAuthority`
  (employee delegates) stays the JML delegation.
- _Ticket answer approval_ is one approve-before-send step bound to the send state
  machine on `Escalation`; kept, listed in the inbox.
- _Performance sign-offs and KPI change requests_ are party acknowledgements per stage
  and acknowledge-then-decide with edits applied — not role chains. Kept.

**Delegation:** a delegator who holds an approval role may delegate, for at most 90
days, to an active login who can read the module's records (`hiring.view`). Delegation
passes decision authority, never data access. Bans follow the holder: a delegate acting
for the submitter or the referrer is refused like them.

**Inbox:** `WorkItem.approval` marks decisions; `/approvals` lists them from every module
provider (the same fan-in Home's "My work" reads) and manages delegations.

`hiring_offer_approvals` is dropped once the new path is verified live.
