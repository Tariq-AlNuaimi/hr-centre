import { Prisma } from "@/generated/prisma/client";
import type { CycleStageKind, RoleTrack } from "@/generated/prisma/client";
import { canActOnEmployee, type PmsActor } from "@/lib/core/permissions";
import { canActOnStage, isGoalSettingExempt, type StageWindow } from "./cycle";

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
    return "This employee has no KPIs yet. A manager drafts them before either party signs.";
  }
  const gap = weightageGap(kpis);
  if (gap.isZero()) return null;
  const total = weightageTotal(kpis);
  return gap.isNegative()
    ? `Weightages total ${total}% — ${gap.abs()}% short of the 100% required to sign off.`
    : `Weightages total ${total}% — ${gap}% over the 100% allowed to sign off.`;
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
    return "Only this employee's direct line manager may draft their KPIs.";
  }
  if (!canActOnStage(stage, now)) {
    return now < stage.opensAt
      ? "Goal-setting has not opened yet for this cycle."
      : "The goal-setting deadline has passed and the stage is locked.";
  }
  if (goalsApprovedAt !== null) {
    return (
      "HR has approved this KPI set, which locks it as the agreed baseline. " +
      "A change now goes through a mid-year change request."
    );
  }
  return null;
}

/** A KPI as the §12.3 split needs to see it: its weight, and which period owns it. */
export type PeriodWeightedKpi = WeightedKpi & { assignmentPeriodId?: string | null };

/**
 * §5.3 applied the way §12.3 needs it — per period on a split year, once on an
 * unsplit one.
 *
 * §12.3 gives each department's manager "their own portion's KPIs" to draft, so
 * each portion is a complete set in its own right and must reach 100% on its
 * own. Summing the two portions to 100 instead would make one manager's drafting
 * depend on the other's, which is exactly the coupling "neither manager owns the
 * full year" removes.
 *
 * When nothing carries a period — the overwhelming majority — this groups into a
 * single bucket and returns precisely what `weightageMessage` returns, so the
 * unsplit path is unchanged rather than merely equivalent.
 */
/**
 * One KPI set per §12.3 portion, in a deterministic order — sorted by period id so
 * a message names the same portion every run rather than whichever the map yielded
 * first. `null` (the unsplit majority) is its own single bucket.
 *
 * Shared so the per-period MESSAGE and the per-period TOTAL cannot bucket
 * differently; they disagreeing is the whole failure mode this rule exists to stop.
 */
function groupByPeriod(kpis: readonly PeriodWeightedKpi[]): PeriodWeightedKpi[][] {
  const byPeriod = new Map<string | null, PeriodWeightedKpi[]>();
  for (const kpi of kpis) {
    const key = kpi.assignmentPeriodId ?? null;
    const bucket = byPeriod.get(key);
    if (bucket) bucket.push(kpi);
    else byPeriod.set(key, [kpi]);
  }
  return [...byPeriod.keys()]
    .sort((a, b) => (a ?? "").localeCompare(b ?? ""))
    .map((key) => byPeriod.get(key) ?? []);
}

export function weightageMessageByPeriod(kpis: readonly PeriodWeightedKpi[]): string | null {
  const periods = groupByPeriod(kpis);
  if (periods.length <= 1) return weightageMessage(kpis);

  for (const period of periods) {
    const message = weightageMessage(period);
    if (message) {
      return `${message} Each period of a split year needs its own complete set.`;
    }
  }
  return null;
}

/**
 * Each portion's weightage total, in the same deterministic period order
 * `weightageMessageByPeriod` uses.
 *
 * One entry for an unsplit year — the overwhelming majority — and one per
 * portion for §12.3's split year.
 */
function weightageTotalsByPeriod(kpis: readonly PeriodWeightedKpi[]): Prisma.Decimal[] {
  return groupByPeriod(kpis).map((period) => weightageTotal(period));
}

/**
 * The ONE total §13.3's roster shows, and compares against 100.
 *
 * §13.3 has a row per employee, not per portion, so it needs a single number —
 * and summing a split year's portions is the wrong one. A correctly-drafted
 * transfer (100% for each of two departments) rendered "Weightages total
 * 200.00%" and carried a weightage warning it had not earned, because §5.3's
 * "exactly 100" binds PER PERIOD (see `Kpi.assignmentPeriodId`), never across
 * them. `signOffBlockedReason` already read it that way; the roster did not.
 *
 * So: the first portion that is not yet exactly 100 — the actionable one, the
 * only number a manager can do anything about — else 100 when every portion is
 * complete. An empty set totals 0, which is not complete and never was.
 *
 * With a single portion this is precisely `weightageTotal`, so the unsplit path
 * is unchanged rather than merely equivalent.
 */
export function rosterWeightageTotal(kpis: readonly PeriodWeightedKpi[]): Prisma.Decimal {
  const totals = weightageTotalsByPeriod(kpis);
  if (totals.length === 0) return new Prisma.Decimal(0);
  return totals.find((total) => !total.equals(REQUIRED_TOTAL)) ?? REQUIRED_TOTAL;
}

/** The three things every screen says about a KPI set's weightage. */
export type WeightageView = {
  /** For display. The actionable portion's total on a split year, never the year's sum. */
  total: string;
  /** §5.3 — signable. Exactly `message === null`, so the badge and the gate cannot disagree. */
  complete: boolean;
  /** Why it is not signable, or null. Names the period on a split year. */
  message: string | null;
};

/**
 * The ONE weightage answer every reader should use.
 *
 * It exists because there were five readers and they did not agree. `/api/status`
 * was taught §12.3's per-period rule while `/api/cycles/:id/participants`,
 * `weightageSummary` and the goal-setting page kept summing the whole year — so a
 * correctly-drafted transfer read "complete" on the team roster and "200.00%, keep
 * drafting" on the manager's own screens, with the sign button disabled over a set
 * the server would have accepted (`signOffBlockedReason` was per-period all along).
 *
 * Returning the trio together is the point: `complete` is defined AS
 * `message === null`, so a future change to the rule moves the badge, the number and
 * the gate in one step instead of three.
 */
export function weightageView(kpis: readonly PeriodWeightedKpi[]): WeightageView {
  const message = weightageMessageByPeriod(kpis);
  return {
    total: rosterWeightageTotal(kpis).toString(),
    complete: message === null,
    message,
  };
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
  kpis: readonly PeriodWeightedKpi[];
  stage: StageWindow;
  now: Date;
}): string | null {
  const { kpis, stage, now } = params;
  if (!canActOnStage(stage, now)) {
    return now < stage.opensAt
      ? "Goal-setting has not opened yet for this cycle."
      : "The goal-setting deadline has passed and the stage is locked.";
  }
  // §12.3 — per period when the year is split, which `weightageMessageByPeriod`
  // reduces to the ordinary single-set check when it is not.
  return weightageMessageByPeriod(kpis);
}

/** The stage KPI drafting and goal sign-off both belong to. */
export const GOAL_SETTING_STAGE: CycleStageKind = "GOAL_SETTING";

/**
 * The complete "may this actor act on this participant's KPI set right now?"
 * chain — §4.2, §8.3, §2, then §5.4/§5.1 via `kpiEditBlockedReason`.
 *
 * Extracted because it had two implementations: `POST /api/kpis` and the RSC
 * drafting page, which reads through Prisma directly (the template's blessed
 * pattern) and so could not go through the route. Two copies of a security
 * ordering drift, and two copies of a sentence drift faster — one of them was
 * already a duplicated string literal.
 *
 * `visible` is answered by the CALLER, because the two of them resolve it
 * differently and both are right: the route computes a descendant set, the page
 * has one in hand. Everything after that is decided here.
 *
 * Returns null when the actor may act. Otherwise a sentence written for the
 * operator and a status: 404 to avoid an existence oracle (§4.2 — a manager
 * probing ids must not learn who exists from a status code), 403 when the actor
 * can see the employee but may not draft for them (QA2 D-15 — an employee
 * drafting their own KPIs got 409, which reads as "try again later"), 409 for a
 * refusal about state.
 */
export type KpiAccessRefusal = { reason: string; status: 403 | 404 | 409 };

export function kpiSetAccessRefusal(params: {
  actor: PmsActor;
  visible: boolean;
  employee: { id: string; managerId: string | null; roleTrack: RoleTrack };
  cycleStatus: string;
  stage: StageWindow | null;
  goalsApprovedAt: Date | null;
  now: Date;
}): KpiAccessRefusal | null {
  const { actor, visible, employee, cycleStatus, stage, goalsApprovedAt, now } = params;

  // §4.2 — visibility before anything else, and 404 rather than 403 on failure.
  if (!visible) return { reason: "Participant not found", status: 404 };

  // §8.3 — C-Level have no goal-setting step, so there is nothing to draft.
  // They stay ENROLLED: §11's reporting and the entity-score pass-through both
  // need the participant row. What §8.3 exempts them from is the work.
  if (isGoalSettingExempt(employee.roleTrack)) {
    return {
      reason:
        "C-Level employees skip goal-setting entirely — there are no KPIs to draft for " +
        "this participant.",
      status: 409,
    };
  }

  // §2 — the year has to be running. A DRAFT cycle has not started and a CLOSED
  // one has stopped moving; neither is a window a stage deadline can reopen.
  if (cycleStatus !== "OPEN") {
    return {
      reason: `KPIs are drafted while the cycle is open — this cycle is ${cycleStatus}.`,
      status: 409,
    };
  }

  if (stage === null) {
    return { reason: "This cycle has no goal-setting stage configured yet.", status: 409 };
  }

  const blocked = kpiEditBlockedReason({
    actor,
    target: { id: employee.id, managerId: employee.managerId },
    stage,
    now,
    goalsApprovedAt,
  });
  if (blocked === null) return null;
  // Authority, not state: the same sentence, the status that says so.
  const authority = !canActOnEmployee(actor, { id: employee.id, managerId: employee.managerId });
  return { reason: blocked, status: authority ? 403 : 409 };
}
