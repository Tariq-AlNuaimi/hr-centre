# Blueprint — the three ambiguous spec clauses, as HR-settable policy on the cycle

> **Partly superseded by ADR-072 (2026-10-19).** UAT Scenario C answered §6.2's re-sign question a
> third way — the employee **acknowledges before HR decides** — so `requireResignAfterChange` is
> retired: it is gone from `CyclePolicy`, from `CYCLE_POLICY_SELECT`, from the input schema and
> from HR's form, and nothing reads it. The database column stays, because a finished cycle must
> keep the rules it was judged by. Everything below about the OTHER two policies (§7.1's divergence
> reason, §8.7's rounding) is unchanged and still current; every mention of
> `requireResignAfterChange` is history.

**Status:** approved to build (operator, 2026-08-28 — "Make them configurable", "Per-cycle, on the
cycle record").
**Scope:** `prisma/schema.prisma`, `prisma/migrations/20260828140000_pms_cycle_policy/**`,
`lib/pms/cycle-policy.ts`, `lib/pms/scoring.ts`, `lib/pms/rating.ts`, `lib/pms/score-run.ts`,
`lib/validations/cycle.ts`, `app/api/cycles/[id]/policy/**`, `app/api/kpi-ratings/route.ts`,
`app/api/scores/route.ts`, `app/api/kpi-change-requests/[id]/decide/route.ts`,
`components/pms/CyclePolicyForm.tsx`, `components/pms/CyclePolicyDialog.tsx`,
`components/pms/CycleList.tsx`, `app/[locale]/(dashboard)/admin/cycles/**`, `messages/*.json`,
`tests/contracts/pms-cycle-policy.test.ts`, `docs/verification/OPEN-QUESTIONS-FOR-RIHAL.md`.

The three routes beyond the policy endpoint itself are the CONSUMERS — the places a policy answer
actually changes behaviour. `scores` bands with it (§8.7), `kpi-ratings` enforces or does not enforce
the divergence reason (§7.1), and `kpi-change-requests/decide` clears the signatures or leaves them
(§6.2). A setting nothing reads is a setting that lies, so they belong in the same change.

**Spec clauses:** §6.2 (mid-year change approval), §7.1 (year-end ratings), §8.7 (bands),
§11.3 (bonus coefficient), §2 (one cycle per year).

## The problem

Three clauses in the specification have more than one reasonable reading, and the build had to pick
one for each. They are written up for Rihal in
[`../verification/OPEN-QUESTIONS-FOR-RIHAL.md`](../verification/OPEN-QUESTIONS-FOR-RIHAL.md). None
has come back answered, and the demo is close.

A choice made by the build is a choice Rihal has not made. Today each one is a constant in the code,
so changing an answer is an engineering task and a deploy. That is the wrong shape for a policy
question: the person who knows the answer is in HR, and the answer may legitimately differ between
performance years.

## Why per-cycle, and not a global settings screen

This is the decision that shapes everything else, so it is worth stating plainly.

§11's reporting reads **historical** cycles. If the band rule lives in one global row and HR flips it
in 2028, then every 2027 scorecard silently re-bands — and §11.3 ties a band to a bonus coefficient,
so a report run after the flip disagrees with the payslip that was actually paid. A global setting
makes the past mutable.

Per-cycle, the rule a cycle ran under is stored **on that cycle**, and a finished year keeps the
rules it was judged by. The cost is a migration and a small form; the alternative costs the integrity
of every historical report.

Corollary, and it is the important half: **the policy freezes when the cycle opens.** HR edits it
while the cycle is `DRAFT`. Once it is `OPEN`, people have started signing and rating against it, and
changing the divergence rule underneath them would invalidate work already done.

## The three settings

| #   | Clause | Setting                    | Default (today's behaviour)                                                                                                                   | The other reading                                                                                              |
| --- | ------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | §6.2   | `requireResignAfterChange` | `false` — the original signature stands; `SignOff.kpiSetHash` records what was signed, and the screen shows the signature predates the change | `true` — an approved mid-year change clears the goal-setting signatures, and both parties sign the revised set |
| 2   | §7.1   | `divergenceReason`         | `REQUIRED` — a manager rating that differs from the employee's must carry a written reason                                                    | `OPTIONAL` (prompted, not enforced) or `OFF` (§7.1's offline discussion alone)                                 |
| 3   | §8.7   | `roundScoreBeforeBanding`  | `false` — bands are `>=` thresholds on the exact score, so 4.495 is Excellent                                                                 | `true` — the score rounds to 2dp first, so 4.495 becomes 4.50 and Outstanding                                  |

Every default is exactly what the code does today, so **applying this migration changes no
behaviour**. That is deliberate: a policy mechanism that quietly re-decides an open question on the
day it ships is worse than no mechanism.

Setting 3 is not cosmetic. At that boundary it is the difference between a 2.0× and a 1.5× bonus
coefficient on basic salary (§11.3).

## Stories

1. **As HR**, I set the three policy answers on a draft cycle, so the year runs under Rihal's rules
   rather than the build's assumptions.
2. **As HR**, I cannot change them once the cycle is open, so nobody is judged by a rule that moved
   after they acted.
3. **As a manager**, if Rihal decided a divergence reason is optional, the field prompts me instead of
   blocking me.
4. **As anyone reading a 2027 report in 2029**, the bands are the ones 2027 was judged by.
5. **As the operator**, the answers arriving from HR are a form to fill in, not a code change.

## Worst paths

| Worst path                                                                  | Required behaviour                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A cycle predates this change and has no policy row                          | The reader falls back to the documented defaults — the same constants the code uses today. No backfill needed, and an old cycle re-bands identically.                                                                              |
| HR edits policy on an OPEN cycle                                            | Refused, 409, naming the reason. The gate is server-side; the form disables as well, but the route is the boundary.                                                                                                                |
| `divergenceReason: OFF` and a manager diverges silently                     | Allowed — that is what OFF means. §7.1's offline discussion is the record, and `SPEC-CONFORMANCE.md` says so.                                                                                                                      |
| `roundScoreBeforeBanding` flipped between two score runs on the SAME cycle  | Only possible while DRAFT, before any scoring can run (§8 runs at year-end on an OPEN cycle). The freeze closes this.                                                                                                              |
| `requireResignAfterChange: true` and HR approves a change after both signed | Both goal-setting sign-offs are cleared in the same transaction as the approval, so the set returns to "awaiting signature" rather than showing a signature for a set nobody signed.                                               |
| A caller forgets to thread the policy through                               | `bandFor` keeps its current single-argument signature and defaults to today's rule; the policy is an explicit second argument. A missed call site behaves exactly as it does now — it does not throw and does not silently invert. |

## Architecture

**Data.** Three columns on `PerformanceCycle`, not a separate table: they are attributes of the
cycle, one row each, always read with it. A separate table would buy nothing but a join.

```prisma
enum DivergenceReasonPolicy { REQUIRED  OPTIONAL  OFF }

model PerformanceCycle {
  // …
  requireResignAfterChange Boolean                @default(false) @map("require_resign_after_change")
  divergenceReason         DivergenceReasonPolicy @default(REQUIRED) @map("divergence_reason")
  roundScoreBeforeBanding  Boolean                @default(false) @map("round_score_before_banding")
}
```

**`lib/pms/cycle-policy.ts`** — the policy type, the defaults, and `policyFor(cycle | null)` so a
null cycle (or a caller that has not loaded one) resolves to today's behaviour in one place rather
than at every call site.

**Threading.** `bandFor(score)` gains an optional second parameter and `divergenceBlockedReason`
gains a `policy` field. Both keep working unchanged when it is absent — see the worst-path table.
`score-run.ts` loads the cycle's policy once per run and passes it to all three `bandFor` calls.

**API.** `PATCH /api/cycles/[id]/policy` — `withRateLimit(withAuth(…))`, HR-only (§4.1), zod
`strictObject`, 409 when the cycle is not DRAFT.

**UI.** A `CyclePolicyForm` section on the cycle admin screen, three controls, each labelled with the
clause it answers and what the other reading would mean. Read-only with an explanation once the
cycle is open.

## Open questions

1. **This does not answer the questions — it makes them answerable.** `OPEN-QUESTIONS-FOR-RIHAL.md`
   stays open until Rihal replies; what changes is that the reply is then a form, not a deploy.
2. **§6.2 re-sign has a second-order effect** if turned on: an unsigned set past the goal-setting
   deadline is what §5.5's ladder escalates on. Clearing signatures mid-year could therefore start
   an escalation about a mid-year change. The ladder only sweeps the GOAL_SETTING stage, so the
   current reading is that it cannot — stated here so that if §6.2 is ever turned on, this is
   checked rather than discovered.
