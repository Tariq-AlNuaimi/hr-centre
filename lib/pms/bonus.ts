import { Prisma } from "@/generated/prisma/client";
import type { Band } from "@/generated/prisma/client";
import { BAND_COEFFICIENT } from "./scoring";

/**
 * §11 — bonus.
 *
 * Pure arithmetic over dates, unpaid leave, a calibrated band and a salary.
 * Nothing here reads the database and nothing here decides who may SEE the
 * result — §4.5 and §11.6 restrict that, and the routes enforce it.
 *
 * ## Decimal, and calendar days
 *
 * §11.4 fixes the basis: "calendar days, matching payroll's ÷365 convention".
 * Not working days, not months. And Decimal throughout, because a bonus is
 * money: `2.0 × 1234.56 × (183/365)` in float is off by fractions of a rial
 * that payroll will notice.
 */

/** §11.4's divisor, stated by the spec rather than derived from the year. */
export const DAYS_IN_YEAR = 365;

/** §11.2's gate, in whole months of EFFECTIVE service. */
export const ELIGIBILITY_MONTHS = 6;

const d = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v);

/** Whole calendar days from `from` to `to`, inclusive of both ends. */
export function inclusiveDays(from: Date, to: Date): number {
  const ms =
    Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) -
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  if (ms < 0) return 0;
  return Math.floor(ms / 86_400_000) + 1;
}

export type WorkDaysInput = {
  cycleStart: Date;
  cycleEnd: Date;
  dateOfJoining: Date;
  /** §12.1 — set for a leaver; null for anyone still employed. */
  lastWorkingDay: Date | null;
  unpaidLeaveDays: number;
};

/**
 * §11.4 — "Work Days = actual calendar days employed within the cycle:
 * mid-year joiner: Date of Joining → year-end. Leaver: cycle start → last
 * working day. Less unpaid leave days."
 *
 * Both ends are clamped to the cycle, so someone who joined years ago starts at
 * the cycle's start and someone still employed runs to its end. Never negative:
 * more unpaid leave than days employed is a data problem, and a negative bonus
 * is not the way to report it.
 */
export function workDays(input: WorkDaysInput): number {
  const { cycleStart, cycleEnd, dateOfJoining, lastWorkingDay, unpaidLeaveDays } = input;

  const start = dateOfJoining > cycleStart ? dateOfJoining : cycleStart;
  const end = lastWorkingDay !== null && lastWorkingDay < cycleEnd ? lastWorkingDay : cycleEnd;

  const employed = inclusiveDays(start, end);
  return Math.max(0, employed - Math.max(0, unpaidLeaveDays));
}

/**
 * §11.2 / §11.5 — effective service in whole months, net of unpaid leave.
 *
 * "Someone employed 7 calendar months with 2 months unpaid leave has 5 months
 * effective service and does not clear the gate." Unpaid leave is given in DAYS,
 * so it is converted at the same ÷365 basis §11.4 uses — mixing a 30-day month
 * here and a 365-day year there is how the two halves of §11 disagree about the
 * same employee.
 */
export function effectiveServiceMonths(input: WorkDaysInput): Prisma.Decimal {
  const { cycleStart, cycleEnd, dateOfJoining, lastWorkingDay } = input;
  const start = dateOfJoining > cycleStart ? dateOfJoining : cycleStart;
  const end = lastWorkingDay !== null && lastWorkingDay < cycleEnd ? lastWorkingDay : cycleEnd;

  const employedDays = inclusiveDays(start, end);
  const netDays = Math.max(0, employedDays - Math.max(0, input.unpaidLeaveDays));
  // 12 months per 365 days — the spec's own basis, applied consistently.
  return d(netDays).times(12).div(DAYS_IN_YEAR);
}

/** §11.2 — "≥ 6 months of effective service in the cycle → eligible." */
export function isBonusEligible(input: WorkDaysInput): boolean {
  return effectiveServiceMonths(input).greaterThanOrEqualTo(ELIGIBILITY_MONTHS);
}

export type BonusResult = {
  eligible: boolean;
  /** Why not, for §11.7's export which "includes and flags" ineligible people. */
  ineligibleReason: string | null;
  workDays: number;
  effectiveMonths: string;
  coefficient: number;
  /** Null when there is no salary on file — distinct from a bonus of zero. */
  amount: string | null;
};

/**
 * §11.3 / §11.4 — "Final Bonus = (Band Coefficient × Basic Salary) × (Work Days
 * ÷ 365)".
 *
 * `band` MUST be the calibrated one: §11.3 — "Bonus is always computed from the
 * calibrated (post-curve) band, never the raw band." This function cannot tell
 * which it was handed, so the caller is responsible; every caller in this
 * codebase reads `EmployeeScore.calibratedBand`.
 */
export function computeBonus(params: {
  band: Band;
  basicSalary: Prisma.Decimal | string | number | null;
  work: WorkDaysInput;
}): BonusResult {
  const { band, basicSalary, work } = params;

  const days = workDays(work);
  const months = effectiveServiceMonths(work);
  const eligible = months.greaterThanOrEqualTo(ELIGIBILITY_MONTHS);
  const coefficient = BAND_COEFFICIENT[band];

  if (!eligible) {
    // §11.7 — ineligible employees are INCLUDED in the export and flagged with
    // the reason, "so nothing looks accidentally omitted".
    return {
      eligible: false,
      ineligibleReason: `Under ${ELIGIBILITY_MONTHS} months of effective service (${months.toFixed(2)})`,
      workDays: days,
      effectiveMonths: months.toFixed(2),
      coefficient,
      amount: null,
    };
  }

  if (basicSalary === null) {
    // Distinct from zero: §3.3 has salary as a required field, so a missing one
    // is an import gap HR must fix, not a person who earns nothing.
    return {
      eligible: true,
      ineligibleReason: null,
      workDays: days,
      effectiveMonths: months.toFixed(2),
      coefficient,
      amount: null,
    };
  }

  const amount = d(coefficient).times(d(basicSalary)).times(d(days)).div(DAYS_IN_YEAR);
  return {
    eligible: true,
    ineligibleReason: null,
    workDays: days,
    effectiveMonths: months.toFixed(2),
    coefficient,
    // Money, to two places. The band coefficient can be 0 (§11.3), and a zero
    // bonus for an eligible person is a real answer rather than an absence.
    amount: amount.toFixed(2),
  };
}
