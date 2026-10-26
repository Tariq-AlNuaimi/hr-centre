import { z } from "zod";

/**
 * Date ranges for HIVE's reporting screen and the ticket queue's date filter
 * (blueprint US-T6/US-T7).
 *
 * Days are Muscat civil days — HR's working day, and the zone `lib/hive/civil.ts`
 * already uses for the rotation. Oman keeps no daylight saving, so a fixed
 * +04:00 offset is exact, and turning a day into an instant needs no library.
 *
 * @public
 */

/** Muscat's UTC offset. No DST, so this is the zone, not an approximation of it. */
const MUSCAT_OFFSET = "+04:00";

/** The longest report range. Keeps the aggregates bounded (Scalable pillar). */
export const REPORT_RANGE_MAX_DAYS = 366;

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD`, and a real calendar day (rejects 2026-02-30). */
export const isoDaySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.")
  .refine((d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().startsWith(d);
  }, "Not a real date.");

/** The instant a Muscat day starts. */
export function muscatDayStart(day: string): Date {
  return new Date(`${day}T00:00:00${MUSCAT_OFFSET}`);
}

/** Today's Muscat date, `days` days back, as `YYYY-MM-DD`. */
function muscatDayAgo(days: number, now: Date): string {
  const shifted = new Date(now.getTime() + 4 * 3_600_000 - days * DAY_MS);
  return shifted.toISOString().slice(0, 10);
}

/**
 * `from`/`to` (both inclusive Muscat days) → a half-open instant range
 * `[gte, lt)`. Defaults to the last 30 days, today included.
 */
export const reportRangeSchema = z
  .object({ from: isoDaySchema.optional(), to: isoDaySchema.optional() })
  .transform(({ from, to }, ctx) => {
    const now = new Date();
    const toDay = to ?? muscatDayAgo(0, now);
    const fromDay = from ?? muscatDayAgo(29, now);
    const gte = muscatDayStart(fromDay);
    const lt = new Date(muscatDayStart(toDay).getTime() + DAY_MS);
    const days = Math.round((lt.getTime() - gte.getTime()) / DAY_MS);
    if (days < 1) {
      ctx.addIssue({ code: "custom", message: "The end date is before the start date." });
      return z.NEVER;
    }
    if (days > REPORT_RANGE_MAX_DAYS) {
      ctx.addIssue({ code: "custom", message: "Pick a range of a year or less." });
      return z.NEVER;
    }
    return { from: fromDay, to: toDay, gte, lt, days };
  });

export type ReportRange = z.output<typeof reportRangeSchema>;
