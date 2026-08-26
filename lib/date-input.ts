/**
 * `<input type="date">` speaks calendar days; the API speaks ISO instants. These
 * three functions are the conversion, and they are shared rather than copied
 * because getting one of them wrong is invisible on screen and wrong by hours.
 *
 * All three work in LOCAL time. That matters twice over:
 *
 * - `endOfDay` is the instant §5.4 locks a deadline at. Sending midnight UTC of
 *   the chosen day instead would lock the stage at 04:00 on the deadline morning
 *   in Oman, and the evening BEFORE it anywhere west of Greenwich — a whole day
 *   of the window silently removed.
 * - `toDateInput` reads the instant back the same way `formatDate` renders it,
 *   so a form and the figure printed above it never name different days.
 *
 * `CycleForm` carried private copies of these for §5's stage deadlines; the 360
 * window (§9.1) needs exactly the same behaviour, and a second copy is how two
 * screens end up disagreeing about when a deadline falls.
 */

/** ISO instant → the "YYYY-MM-DD" an `<input type="date">` expects, local time. */
export function toDateInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Start of the chosen day, local time. `""` when the input is not a usable date.
 *
 * `<input type="date">` will happily hand over a six-digit year, and
 * `new Date("123456-09-13T00:00:00")` is Invalid — so an unguarded
 * `toISOString()` throws a RangeError. From a component body that is a crashed
 * screen instead of an inline validation message, which is why these return a
 * value rather than throwing.
 */
export function startOfDay(dateInput: string): string {
  return toInstant(`${dateInput}T00:00:00`);
}

/** End of the chosen day, local time — the instant §5.4 locks at. `""` if unusable. */
export function endOfDay(dateInput: string): string {
  return toInstant(`${dateInput}T23:59:59`);
}

function toInstant(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
