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

Option 1. **Migrated now: Hiring offers** — every round is copied (pending offers keep
their chain and decisions; decided offers keep their history), submit/resubmit open a
round, leaving approval cancels it, decisions go through `decide`. Sentences and their
order are unchanged (parity test). New: a delegate may decide for a holder.

**Not migrated, and why:**

- _Hiring requisitions and JD sign-off_ fit the engine (a two-step chain; a two-signatory
  round per JD version) but are tied to the status-history round and JD versioning;
  they move in a follow-up with their own parity tests. Until then they are listed in the
  Approvals inbox from their module provider.
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
