import { Prisma } from "@/generated/prisma/client";
import type { CycleStageKind } from "@/generated/prisma/client";
import { canActOnEmployee, type PmsActor } from "./permissions";
import { canActOnStage, type StageWindow } from "./cycle";

/**
 * KPI rules — spec §5.2 (what a manager authors) and §5.3 (the 100% rule).
 *
 * This module is the SHARED SEAM between KPI drafting and sign-off. §5.3 says
 * "KPIs cannot be signed off or locked unless individual KPI weightages total
 * exactly 100%", which means the rule is consumed by three different callers —
 * the drafting UI's live total, the sign-off route, and HR's approval. Putting
 * it anywhere else guarantees two of them eventually disagree about what 100%
 * means.
 */

/**
 * §5.2's five levels, with the numeric values the spec assigns them. Phase 5's
 * scoring reads these; Phase 2 only needs the labels and the ordering.
 */
export const KPI_LEVELS = [
  { key: "descriptorOutstanding", label: "Outstanding", value: 5 },
  { key: "descriptorExcellent", label: "Excellent", value: 4 },
  { key: "descriptorTarget", label: "Target", value: 3 },
  { key: "descriptorAlmostAchieved", label: "Almost Achieved", value: 2 },
  { key: "descriptorUnsatisfactory", label: "Unsatisfactory", value: 1 },
] as const;

export type KpiLevelKey = (typeof KPI_LEVELS)[number]["key"];

/** The shape the weightage rule needs. Anything with a weightage qualifies. */
export type WeightedKpi = { weightage: Prisma.Decimal | string | number };

/**
 * Total weightage across a KPI set, as an exact decimal.
 *
 * Decimal arithmetic, not floating point, and not by accident: §5.3 compares
 * against EXACTLY 100, and `0.1 + 0.2 !== 0.3` in binary floating point. A set
 * of 3 KPIs at 33.33 and one at 0.01 must be judged on what the numbers say,
 * not on what IEEE-754 rounds them to.
 */
export function weightageTotal(kpis: readonly WeightedKpi[]): Prisma.Decimal {
  return kpis.reduce(
    (sum, kpi) => sum.plus(new Prisma.Decimal(kpi.weightage.toString())),
    new Prisma.Decimal(0),
  );
}

export const REQUIRED_TOTAL = new Prisma.Decimal(100);

/** §5.3 — exactly 100, no tolerance. */
export function isWeightageComplete(kpis: readonly WeightedKpi[]): boolean {
  return weightageTotal(kpis).equals(REQUIRED_TOTAL);
}

/**
 * How far a set is from signable, as a signed decimal: negative means short,
 * positive means over.
 *
 * Returned rather than a bare boolean because §5.3's failure needs to be
 * actionable — "you are 5% short" is a fixable message, "invalid" is not.
 */
export function weightageGap(kpis: readonly WeightedKpi[]): Prisma.Decimal {
  return weightageTotal(kpis).minus(REQUIRED_TOTAL);
}

/** Human-readable form of the gap, for API errors and the drafting UI alike. */
export function weightageMessage(kpis: readonly WeightedKpi[]): string | null {
  if (kpis.length === 0) {
    return "This employee has no KPIs yet. A manager drafts them before either party signs (§5.1).";
  }
  const gap = weightageGap(kpis);
  if (gap.isZero()) return null;
  const total = weightageTotal(kpis);
  return gap.isNegative()
    ? `Weightages total ${total}% — ${gap.abs()}% short of the 100% required to sign off (§5.3).`
    : `Weightages total ${total}% — ${gap}% over the 100% allowed to sign off (§5.3).`;
}

/**
 * Why a KPI set cannot be edited right now, or null when it can.
 *
 * Three independent gates, checked in the order a person would ask them:
 *
 *   1. §4.2 — is this even your report? Editing and sign-off are "always
 *      reserved for the direct line manager"; a chain two levels down is
 *      view-only. HR overrides (§4.1 "everything + overrides").
 *   2. §5.4 — is the stage open? A hard lock, identical for every actor.
 *   3. §5.1 — has HR approved? Approval IS the lock, and after it the baseline
 *      is fixed. The correction path is Phase 3's change request (§6.2), not a
 *      quiet edit.
 *
 * Returned as a message rather than a boolean so the caller can say WHICH of the
 * three refused, which is the difference between an app that feels broken and
 * one that feels governed.
 */
export function kpiEditBlockedReason(params: {
  actor: PmsActor;
  target: { id: string; managerId: string | null };
  stage: StageWindow;
  now: Date;
  goalsApprovedAt: Date | null;
}): string | null {
  const { actor, target, stage, now, goalsApprovedAt } = params;

  if (!canActOnEmployee(actor, target)) {
    return "Only this employee's direct line manager may draft their KPIs (§4.2).";
  }
  if (!canActOnStage(stage, now)) {
    return now < stage.opensAt
      ? "Goal-setting has not opened yet for this cycle (§2)."
      : "The goal-setting deadline has passed and the stage is locked (§5.4).";
  }
  if (goalsApprovedAt !== null) {
    return (
      "HR has approved this KPI set, which locks it as the agreed baseline (§5.1). " +
      "A change now goes through a mid-year change request."
    );
  }
  return null;
}

/**
 * §5.3 — why this set cannot be signed, or null when it can.
 *
 * Sign-off has the same stage lock as editing but NOT the approval lock: HR's
 * approval comes after both signatures, so a set that is already approved is
 * simply already signed, and the caller reports that as an idempotent no-op
 * rather than an error.
 */
export function signOffBlockedReason(params: {
  kpis: readonly WeightedKpi[];
  stage: StageWindow;
  now: Date;
}): string | null {
  const { kpis, stage, now } = params;
  if (!canActOnStage(stage, now)) {
    return now < stage.opensAt
      ? "Goal-setting has not opened yet for this cycle (§2)."
      : "The goal-setting deadline has passed and the stage is locked (§5.4).";
  }
  return weightageMessage(kpis);
}

/** The stage KPI drafting and goal sign-off both belong to. */
export const GOAL_SETTING_STAGE: CycleStageKind = "GOAL_SETTING";
