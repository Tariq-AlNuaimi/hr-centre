import { zonedTimeToUtc } from "@/lib/working-time/calendar";

/**
 * P2-5 — scheduled access cut-off for leavers (Rippling-style scheduled
 * deprovisioning). Pure: the sweep, the route and the Access tab share it.
 *
 * The login is cut at an INSTANT, not "some time the day after": by default
 * 17:00 in the schedule's zone (Asia/Muscat) on the Last Physical Working Day,
 * which is when the leaver walks out. HR may move it (earlier for a
 * garden-leave exit, later for a handover evening). The hourly sweep revokes at
 * its first run on or after the instant.
 */

const DEFAULT_CUTOFF_HOUR = 17;

/** 17:00 local on the Last Physical Working Day (a calendar date), or null. */
export function defaultCutoff(lastPhysicalWorkingDay: Date | null, timeZone: string): Date | null {
  if (!lastPhysicalWorkingDay) return null;
  return zonedTimeToUtc(
    lastPhysicalWorkingDay.getUTCFullYear(),
    lastPhysicalWorkingDay.getUTCMonth() + 1,
    lastPhysicalWorkingDay.getUTCDate(),
    DEFAULT_CUTOFF_HOUR,
    0,
    timeZone,
  );
}

/** The cut-off in force: HR's explicit instant, else the default. */
export function effectiveCutoff(
  detail: { accessCutoffAt: Date | null; lastPhysicalWorkingDay: Date | null },
  timeZone: string,
): Date | null {
  return detail.accessCutoffAt ?? defaultCutoff(detail.lastPhysicalWorkingDay, timeZone);
}

/** "2027-05-12T17:30" (a wall-clock time in the schedule's zone) → the instant. */
export function localInputToInstant(value: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  // QA2 N-09 — a REAL day: "2026-02-30" used to roll silently to 2 March (a
  // past instant, so the next sweep would have revoked the login at once).
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return null;
  return zonedTimeToUtc(y, mo, d, h, mi, timeZone);
}

export type AccessDomainSummary = {
  domain: string;
  total: number;
  done: number;
  overdue: number;
};

/**
 * The Access tab's per-system status summary: per domain, how many items there
 * are, how many are confirmed and how many are past due — the "what is still
 * open on day X" view, without reading every row.
 */
export function accessSummary(
  items: readonly { domain: string; dueDate: Date; confirmedDate: Date | null }[],
  today: Date,
): AccessDomainSummary[] {
  const by = new Map<string, AccessDomainSummary>();
  for (const i of items) {
    const row = by.get(i.domain) ?? { domain: i.domain, total: 0, done: 0, overdue: 0 };
    row.total += 1;
    if (i.confirmedDate) row.done += 1;
    else if (i.dueDate < today) row.overdue += 1;
    by.set(i.domain, row);
  }
  return [...by.values()];
}
