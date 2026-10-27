/**
 * Leaver reporting rules, pure (HR Offboarding `reports.ts` / `reporting/queries.ts`,
 * §12.5, AC-14.x). Ratios are never estimated: a measure whose denominator
 * is missing is reported as unavailable, with what it needs.
 */

export const SMALL_CELL_THRESHOLD = 4;
export const BELOW_THRESHOLD = "__below_reporting_threshold__";

export type Cell = Record<string, string | number | null>;

/**
 * BR-OFF-024 / AC-14.2–14.3: cells with fewer than 4 exits collapse into one
 * "below threshold" row (its count shown only when it is itself ≥ 4).
 * Applied at assembly, so an export carries the suppression too.
 */
export function suppressSmallCells(cells: readonly Cell[], countKey: string, labelKey: string) {
  const keep = cells.filter((c) => Number(c[countKey]) >= SMALL_CELL_THRESHOLD);
  const small = cells.filter((c) => Number(c[countKey]) < SMALL_CELL_THRESHOLD);
  if (small.length === 0) return { cells: [...keep], suppressed: 0 };
  const total = small.reduce((a, c) => a + Number(c[countKey]), 0);
  const merged: Cell = {
    [labelKey]: BELOW_THRESHOLD,
    [countKey]: total >= SMALL_CELL_THRESHOLD ? total : null,
    cellsMerged: small.length,
  };
  return { cells: [...keep, merged], suppressed: small.length };
}

/** F17 fixed: whole calendar months on UTC dates (the source used local time). */
export function monthsBetween(from: Date, to: Date): number {
  let m =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

export const TENURE_BANDS = ["0-6", "7-12", "13-24", "25-60", "60+"] as const;

/** R5 bands, inclusive upper bounds, in months. */
export function tenureBand(
  hire: Date | null,
  lds: Date | null,
): (typeof TENURE_BANDS)[number] | null {
  if (!hire || !lds) return null;
  const m = monthsBetween(hire, lds);
  if (m <= 6) return "0-6";
  if (m <= 12) return "7-12";
  if (m <= 24) return "13-24";
  if (m <= 60) return "25-60";
  return "60+";
}

export const quarterOf = (d: Date) =>
  `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
export const monthOf = (d: Date) => d.toISOString().slice(0, 7);

/** The LOWER median (the source's convention), null for an empty set. */
export function lowerMedian(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
}

export const mean = (xs: readonly number[], dp = 1): number | null =>
  xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10 ** dp) / 10 ** dp : null;

export const ratio = (num: number, den: number, dp = 1): number | null =>
  den > 0 ? Math.round((num / den) * 100 * 10 ** dp) / 10 ** dp : null;

const DAY = 86_400_000;
export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);

/**
 * §12.5.2 attrition: exits / average headcount × 100, average = (opening +
 * closing) / 2, annualised × 365 / period days when the period is under a
 * year. A non-positive denominator is unavailable, never zero.
 */
export function attritionRate(exits: number, opening: number, closing: number, periodDays: number) {
  const average = (opening + closing) / 2;
  if (!(average > 0)) return { averageHeadcount: average, rate: null, annualised: null };
  const rate = Math.round((exits / average) * 100 * 10) / 10;
  const annualised = periodDays < 365 ? Math.round(rate * (365 / periodDays) * 10) / 10 : rate;
  return { averageHeadcount: average, rate, annualised };
}

/** Whether an employee counts in headcount on a day (core record: joined, not yet gone). */
export function employedOn(
  e: { dateOfJoining: Date | null; lastWorkingDay: Date | null },
  day: Date,
): boolean {
  if (!e.dateOfJoining || e.dateOfJoining > day) return false;
  return !e.lastWorkingDay || e.lastWorkingDay >= day;
}

/** R7 buckets. */
export function settlementBucket(s: {
  paymentConfirmedAt: Date | null;
  approvedAt: Date | null;
  provisional: boolean;
}) {
  if (s.paymentConfirmedAt) return "PAID";
  if (s.approvedAt) return "APPROVED_AWAITING_PAYMENT";
  if (s.provisional) return "PROVISIONAL_UNVERIFIED_INPUTS";
  return "AWAITING_APPROVAL";
}

/** R4: the most common reason and its share of the manager's exits. */
export function topReason(codes: readonly (string | null)[]) {
  const counts = new Map<string, number>();
  for (const c of codes) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return top
    ? { code: top[0], concentration: ratio(top[1], codes.length) }
    : { code: null, concentration: null };
}
