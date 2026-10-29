# P2 platform — core approvals engine (ADR-094)

Scope: lib/core/approvals/**, lib/validations/core/approvals.ts, lib/hiring/offer-round.ts, lib/hiring/offer-approvals.ts, lib/hiring/offer-write.ts, lib/hiring/offer-versions.ts, lib/hiring/offer-rules.ts, lib/hiring/offers.ts, lib/hiring/work-items.ts, lib/hiring/erasure.ts, lib/jml/work-items.ts, lib/hive/services/work-items.ts, lib/core/work-items/index.ts, lib/nav/config.ts, app/api/approvals/**, app/[locale]/(dashboard)/approvals/page.tsx, components/approvals/**, prisma/schema.prisma, prisma/migrations/20261029123839_core_approvals/**, tests/contracts/core-approvals.test.ts, tests/integration/core-approvals.test.ts

Status: operator-approved P2 roadmap, item 1. Audit: `ux/tickets-hiring.md` P2-1, `ux/performance-jml.md` P2-7.
Feature parity: n/a — consolidation of existing approval behaviour; delegation follows the common "out of office approver" pattern (Workday delegations, Greenhouse approver replacement).

## Stories and acceptance criteria

- **US-1 (module developer) one engine.** AC-1.1 `openRound` creates a round with step 1
  current and cancels any open round of the subject. AC-1.2 `decide` refuses with a code:
  no submitter, submitter (self-approval), excluded (conflict), prior step, already decided,
  not qualified. AC-1.3 A two-holder step passes on the second distinct approver. AC-1.4 A
  rejection or send-back closes the round and cancels waiting steps. AC-1.5 Two racing
  decisions: exactly one wins. AC-1.6 The module's subject update commits in the same
  transaction as the decision.
- **US-2 (approver) offers work exactly as before.** AC-2.1 Same chain, same refusals, same
  sentences in the same order (parity test). AC-2.2 A reason is still required for reject /
  send back. AC-2.3 A pay revision on a sent offer restarts approval in a fresh round.
  AC-2.4 Every existing round is copied: pending offers keep chain and decisions.
- **US-3 (approver going on leave) delegate.** AC-3.1 On Approvals I pick a colleague with
  hiring access and dates (≤ 90 days); they can decide what I could, recorded as on my
  behalf. AC-3.2 Bans follow me (they can't approve an offer I submitted). AC-3.3 I can end
  it; nobody else can (404).
- **US-4 (anyone who approves) one inbox.** AC-4.1 /approvals lists every decision waiting on
  me across Hiring, JML and HR tickets; a module that fails to load is named. AC-4.2 The
  sidebar shows Approvals only to people who can be routed one.
- **US-5 (candidate) erasure covers the copy.** AC-5.1 Erasing a candidate erases their
  name from approval rounds.

## Worst paths

- Pending offer without a copied round → decide refuses "changed since you loaded it".
- Delegate without hiring access → POST refused (422); delegation never grants reads.
- Expired or revoked delegation → not counted (window checked on read).
- Admin proxy → may decide (recorded `via_proxy`), but is not listed as "waiting on you".

## Data

Migration `20261029123839_core_approvals` creates the four tables and copies `hiring_offer_approvals` rounds
(evidence: scratch replay — 3 offers → 3 rounds, 6 steps, 4 decisions, statuses
PENDING / APPROVED / SENT_BACK as expected).
