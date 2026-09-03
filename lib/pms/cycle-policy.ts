import type { DivergenceReasonPolicy } from "@/generated/prisma/client";

/**
 * The three places §1–§14 admits more than one reading, resolved per CYCLE.
 *
 * These are not preferences. Each one is a clause where the specification does
 * not say what should happen, so the build had to choose — and a choice made by
 * the build is a choice Rihal has not made. They are written up as questions in
 * `docs/verification/OPEN-QUESTIONS-FOR-RIHAL.md`; this module is what turns an
 * answer into a form to fill in rather than a deploy.
 *
 * WHY PER CYCLE. §11's reporting reads historical cycles and §11.3 ties a band
 * to a bonus coefficient. A single global rule flipped in 2028 would silently
 * re-band every 2027 scorecard, so a report run afterwards would disagree with
 * the payslip that was actually paid. Storing the rule on the cycle means a
 * finished year keeps the rules it was judged by, and the past stops being
 * mutable.
 *
 * WHY THE DEFAULTS ARE TODAY'S BEHAVIOUR. A policy mechanism that re-decides an
 * open question on the day it ships is worse than no mechanism. Every default
 * below is exactly what the constants in `scoring.ts` / `rating.ts` did before
 * this file existed, so adding it changed nothing.
 */

export type CyclePolicy = {
  /** §6.2 — must both parties sign again after HR approves a mid-year change? */
  requireResignAfterChange: boolean;
  /** §7.1 — how hard does the system insist on a reason for a divergent rating? */
  divergenceReason: DivergenceReasonPolicy;
  /** §8.7 — round the final score to 2dp before choosing a band? */
  roundScoreBeforeBanding: boolean;
};

/**
 * What the system did before any of this was configurable.
 *
 * Frozen, and used for every cycle that carries no policy of its own — which is
 * every cycle created before the migration. There is deliberately no backfill:
 * the defaults ARE the old behaviour, so an old cycle re-bands identically.
 */
export const DEFAULT_CYCLE_POLICY: CyclePolicy = {
  requireResignAfterChange: false,
  divergenceReason: "REQUIRED",
  roundScoreBeforeBanding: false,
};

/**
 * Resolve a policy from whatever the caller managed to load.
 *
 * Null-tolerant on purpose. A caller that has no cycle in hand — a pure
 * function under test, a screen rendering before its query resolves, a code
 * path that predates this feature — gets the documented default rather than a
 * throw. The failure mode of a missing policy must be "behaves as it always
 * did", never "crashes" and never "silently inverts".
 */
export function policyFor(cycle: Partial<CyclePolicy> | null | undefined): CyclePolicy {
  if (!cycle) return DEFAULT_CYCLE_POLICY;
  return {
    requireResignAfterChange:
      cycle.requireResignAfterChange ?? DEFAULT_CYCLE_POLICY.requireResignAfterChange,
    divergenceReason: cycle.divergenceReason ?? DEFAULT_CYCLE_POLICY.divergenceReason,
    roundScoreBeforeBanding:
      cycle.roundScoreBeforeBanding ?? DEFAULT_CYCLE_POLICY.roundScoreBeforeBanding,
  };
}

/** The columns to select when a query needs the policy. One list, one source. */
export const CYCLE_POLICY_SELECT = {
  requireResignAfterChange: true,
  divergenceReason: true,
  roundScoreBeforeBanding: true,
} as const;

/**
 * §2 — the policy is HR's to set, and only while the cycle is a DRAFT.
 *
 * The freeze is the point, not a convenience. Once a cycle is OPEN people have
 * signed and rated against these rules; moving the divergence rule underneath
 * them would invalidate work already done, and moving the band rule would
 * re-price a bonus after the fact (§11.3). Returns the refusal sentence, or
 * null when the edit is allowed.
 */
export function policyEditBlockedReason(cycleStatus: string): string | null {
  if (cycleStatus === "DRAFT") return null;
  return (
    "The cycle policy can only be changed while the cycle is a draft. This cycle is " +
    `${cycleStatus.toLowerCase()}, so people have already signed and rated under these rules ` +
    "(§2, §7.1, §8.7)."
  );
}
