// Hoisted date/time formatters (CP-PO8).
//
// Constructing an `Intl.DateTimeFormat` is the expensive part of date display;
// `.format()` on an existing instance is cheap. Building the formatters ONCE at
// module load (instead of `new Date(v).toLocaleString(...)` inside a table
// `render` callback, which ran per row on every re-render) keeps large lists
// snappy. Locale is the runtime default, matching the previous `toLocale*`
// call sites; the table cells already re-render under the active next-intl
// locale's provider.

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});

/** Medium date + short time, no seconds, e.g. "Jun 19, 2026, 2:31 PM" (UX P1: one date style). */
export function formatDateTime(value: string | number | Date): string {
  return dateTimeFormatter.format(new Date(value));
}

/** Medium date, no time, e.g. "Jun 19, 2026". */
export function formatDate(value: string | number | Date): string {
  return dateFormatter.format(new Date(value));
}

// Calendar days (a `@db.Date` column arrives as midnight UTC) are formatted in
// UTC, so a viewer west of Greenwich never sees the day before.
const dayFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });

/** A calendar day, e.g. "Oct 25, 2026" — the one date style JML and Hiring share (UX P1). */
export function formatDay(value: string | number | Date): string {
  return dayFormatter.format(new Date(value));
}

const zonedDayFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * A moment as the calendar day it falls on in `timeZone` (default Muscat), in
 * the same medium style — for a start date stored at local midnight, which is
 * the previous day in UTC.
 */
export function formatZonedDay(value: string | number | Date, timeZone = "Asia/Muscat"): string {
  let f = zonedDayFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone });
    zonedDayFormatters.set(timeZone, f);
  }
  return f.format(new Date(value));
}

/**
 * Whole calendar days from `today` to `due` (negative = overdue), compared as
 * UTC dates so the time of day never changes the answer. Pure.
 */
export function daysUntil(due: string | Date, today: Date = new Date()): number {
  const d = new Date(due);
  const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const b = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((a - b) / 86_400_000);
}
