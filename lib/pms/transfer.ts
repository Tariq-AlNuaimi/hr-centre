import { Prisma } from "@/generated/prisma/client";
import { DAYS_IN_YEAR, inclusiveDays } from "./bonus";

/**
 * §12.3 — transfers mid-cycle (department/entity change).
 *
 * "Individual KPIs are split across the two periods … Proration basis: same
 * calendar-day logic as bonus — each period weighted by days-in-department ÷
 * 365.
 *
 *   Prorated individual score = (Old-period KPI score × old days/365) +
 *   (New-period KPI score × new days/365) — with departmental/corporate
 *   components day-weighted the same way."
 *
 * `inclusiveDays` is imported from the bonus module deliberately rather than
 * re-derived: §12.3 says "SAME calendar-day logic as bonus", and two
 * implementations of "how many days" is exactly the kind of near-agreement that
 * produces a score nobody can reconcile against a payslip.
 *
 * The denominator is 365, not the sum of the periods' days. That is what the
 * clause prints, and it matters for a leaver or a mid-year joiner whose periods
 * do not cover the whole year: their weights then sum to less than 1, which
 * pro-rates their score down exactly as §11.4 pro-rates their bonus. Normalising
 * to the covered days instead would silently pay a half-year employee a full
 * year's score.
 */

const HUNDRED = new Prisma.Decimal(100);

export type PeriodWindow = { startsOn: Date; endsOn: Date };

/**
 * Days in one period, inclusive of both ends — §11.4's convention.
 *
 * Zero when the window is inverted, which is how `clampToService` reports a
 * period the employee was not employed for any of.
 */
export function periodDays(period: PeriodWindow): number {
  if (period.endsOn < period.startsOn) return 0;
  return inclusiveDays(period.startsOn, period.endsOn);
}

/** The period's share of the year: days ÷ 365. */
export function periodWeight(period: PeriodWindow): Prisma.Decimal {
  return new Prisma.Decimal(periodDays(period)).div(DAYS_IN_YEAR);
}

export type WeightedPeriodScore = PeriodWindow & {
  /** This period's score for one component, on §8.1's 1–5 scale. */
  score: Prisma.Decimal | string | number | null;
};

/**
 * Day-weight a component across a split year.
 *
 * Returns null when no period carries a score — a transferred employee whose
 * new manager has not assessed yet has no prorated figure, and inventing one
 * from the half that IS complete would let a partial assessment become a final
 * score. §12.3's "HR signs off / consolidates" is the step that closes that,
 * and it cannot close what was silently computed already.
 */
export function proratedComponent(periods: readonly WeightedPeriodScore[]): Prisma.Decimal | null {
  if (periods.length === 0) return null;
  if (periods.some((p) => p.score === null)) return null;
  let total = new Prisma.Decimal(0);
  for (const p of periods) {
    total = total.plus(new Prisma.Decimal(p.score as Prisma.Decimal).times(periodWeight(p)));
  }
  return total;
}

/**
 * The two windows a transfer on `transferDate` splits a cycle into.
 *
 * The transfer date belongs to the NEW department: someone who moves on 1 July
 * works 1 July in the new team, so the old period ends 30 June. Getting this
 * backwards double-counts a day across the two periods, and §12.3's weights are
 * meant to sum to the year.
 *
 * Returns null when the date falls outside the cycle — a "transfer" before the
 * cycle opened is a starting position, not a split, and one after it closed
 * belongs to next year.
 */
export function splitWindows(params: {
  cycleStart: Date;
  cycleEnd: Date;
  transferDate: Date;
}): { before: PeriodWindow; after: PeriodWindow } | null {
  const { cycleStart, cycleEnd, transferDate } = params;
  if (transferDate <= cycleStart || transferDate > cycleEnd) return null;
  const dayBefore = new Date(transferDate.getTime());
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  return {
    before: { startsOn: cycleStart, endsOn: dayBefore },
    after: { startsOn: transferDate, endsOn: cycleEnd },
  };
}

/**
 * §5.3 per period — "KPIs cannot be signed or locked unless weightages total
 * exactly 100%", applied to each department's own portion.
 *
 * §12.3 gives each department's manager their own portion to draft, so each
 * portion is a complete KPI set in its own right. Summing the two to 100 instead
 * would make one manager's drafting depend on the other's, which is the coupling
 * §12.3 removes ("neither manager owns the full year").
 */
export function periodWeightageBlockedReason(params: {
  orderIndex: number;
  weightageTotal: Prisma.Decimal;
}): string | null {
  if (params.weightageTotal.equals(HUNDRED)) return null;
  return `§5.3: period ${params.orderIndex + 1}'s weightages total ${params.weightageTotal.toFixed(
    2,
  )}%, not 100 — each period's KPI set must be complete on its own (§12.3).`;
}

/**
 * §12.3 — who may draft and assess ONE period's KPIs.
 *
 * "Each department's manager drafts and assesses their own portion's KPIs; HR
 * signs off / consolidates (neither manager owns the full year)."
 *
 * Everywhere else the manager is resolved LIVE from `Employee.managerId` (§7.2),
 * and that is correct — but a split year is the one case where it gives the
 * wrong answer in both directions. After the transfer the live lookup names the
 * NEW manager, who would then own the old department's KPIs they never set; and
 * it denies the OLD manager, who is the only person who can honestly assess the
 * half they supervised.
 *
 * So authority over a period is the period's OWN snapshotted manager. HR still
 * overrides, per §4.1 and §12.3's "HR signs off / consolidates".
 *
 * Returns null when the actor may act, or the refusal sentence otherwise.
 */
export function periodAuthorityBlockedReason(params: {
  actorEmployeeId: string | null;
  actorIsHr: boolean;
  period: { orderIndex: number; managerEmployeeId: string | null };
}): string | null {
  const { actorEmployeeId, actorIsHr, period } = params;
  if (actorIsHr) return null;
  if (actorEmployeeId !== null && period.managerEmployeeId === actorEmployeeId) return null;
  return `Period ${
    period.orderIndex + 1
  } belongs to the manager who held the relationship during it (§12.3).`;
}

/**
 * Clamp a period to the days the employee was actually employed.
 *
 * §12.3's split is created at TRANSFER time, when period 2 runs to the end of
 * the cycle — correct then. A departure recorded later moves the employee's last
 * working day but does not, and should not, rewrite the split: the period is a
 * record of where they sat, not of how long they stayed.
 *
 * So the clamp happens at SCORING time, here, and not in the leavers route.
 * §12.1 lets a departure arrive through the IMPORT as well as through
 * `POST /api/leavers`, and an import-recorded leaver never passes through that
 * route at all — truncating there would fix one path and leave the other
 * silently wrong. Clamping where the weight is computed covers both.
 *
 * Both ends, for the same reason §11.4 clamps both: a mid-year joiner who then
 * transfers has a period 1 that starts before they were employed, and counting
 * those days inflates their score exactly as counting a departed employee's
 * remaining months would.
 *
 * A period entirely outside the service window collapses to zero days and
 * therefore zero weight, which is the honest answer — not an error.
 */
export function clampToService(
  period: PeriodWindow,
  service: { dateOfJoining: Date | null; lastWorkingDay: Date | null },
): PeriodWindow {
  const { dateOfJoining, lastWorkingDay } = service;
  const startsOn =
    dateOfJoining !== null && dateOfJoining > period.startsOn ? dateOfJoining : period.startsOn;
  const endsOn =
    lastWorkingDay !== null && lastWorkingDay < period.endsOn ? lastWorkingDay : period.endsOn;
  return { startsOn, endsOn };
}
