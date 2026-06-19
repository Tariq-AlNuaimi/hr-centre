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
  dateStyle: "short",
  timeStyle: "medium",
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});

/** Short date + medium time, e.g. "6/19/26, 2:31:07 PM". */
export function formatDateTime(value: string | number | Date): string {
  return dateTimeFormatter.format(new Date(value));
}

/** Medium date, no time, e.g. "Jun 19, 2026". */
export function formatDate(value: string | number | Date): string {
  return dateFormatter.format(new Date(value));
}
