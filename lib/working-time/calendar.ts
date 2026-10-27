/**
 * ONE working calendar for HR Centre (ADR-077) — every due date, working-day
 * count and notification window in the JML module reads this file.
 *
 * Merges the two source implementations, which disagreed:
 *  - HR Offboarding `lib/offboarding/dates.ts` — ISO weekend days, working-day
 *    offsets, `n = 0` snaps FORWARD, `workingDaysBetween` counts the days after
 *    `from` up to and including `to`.
 *  - HR Onboarding `activation.ts dueDateFrom` — CALENDAR-day offsets rolled
 *    forward off the weekend; `working-window.ts` — the Asia/Muscat send window.
 * Neither knew about public holidays, and Onboarding's due dates ignored its own
 * configured schedule (port defect 8.4.4). Both are fixed here: a non-working
 * day is a weekend day of the schedule OR a public holiday.
 *
 * Dates are CALENDAR dates (Postgres `date`), handled in UTC on their Y-M-D
 * parts so a server in any zone computes the same answer. Instants (the send
 * window) are converted explicitly through Intl with the schedule's time zone.
 *
 * Pure: the caller loads the schedule and holidays once (lib/working-time/load.ts).
 */

/** ISO weekday numbers: Mon = 1 … Sun = 7. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type WorkingSchedule = {
  /** ISO weekdays that are working days. Default Sun–Thu = [7, 1, 2, 3, 4]. */
  workingDays: readonly number[];
  startHour: number;
  endHour: number;
  timeZone: string;
};

export const DEFAULT_SCHEDULE: WorkingSchedule = {
  workingDays: [7, 1, 2, 3, 4],
  startHour: 8,
  endHour: 17,
  timeZone: "Asia/Muscat",
};

/** The schedule plus the holiday dates ("YYYY-MM-DD") it is evaluated with. */
export type WorkingCalendar = {
  schedule: WorkingSchedule;
  holidays: ReadonlySet<string>;
};

export const DEFAULT_CALENDAR: WorkingCalendar = {
  schedule: DEFAULT_SCHEDULE,
  holidays: new Set(),
};

const DAY_MS = 86_400_000;

/** ISO weekday of a calendar date, read in UTC. */
export function isoWeekday(date: Date): IsoWeekday {
  const js = date.getUTCDay();
  return (js === 0 ? 7 : js) as IsoWeekday;
}

/** A UTC-midnight copy — callers' Dates are never mutated. */
export function utcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** "YYYY-MM-DD" of a calendar date (UTC parts). */
export function dayKey(date: Date): string {
  return utcDate(date).toISOString().slice(0, 10);
}

/** The ISO weekdays that are NOT working days — derived, so it cannot contradict. */
export function weekendDays(schedule: WorkingSchedule): IsoWeekday[] {
  const working = new Set(schedule.workingDays);
  return ([1, 2, 3, 4, 5, 6, 7] as IsoWeekday[]).filter((d) => !working.has(d));
}

function assertHasWorkingDays(schedule: WorkingSchedule): void {
  if (schedule.workingDays.length === 0) {
    throw new Error("The working schedule has no working days; no due date could ever be set");
  }
}

/** A working day: a weekday of the schedule that is not a public holiday. */
export function isWorkingDay(date: Date, calendar: WorkingCalendar = DEFAULT_CALENDAR): boolean {
  return (
    calendar.schedule.workingDays.includes(isoWeekday(date)) && !calendar.holidays.has(dayKey(date))
  );
}

/** Bound on any day-walk: a year of holidays back-to-back would be a data error. */
const MAX_WALK = 400;

/** The date itself if it is a working day, otherwise the next one. */
function rollForward(date: Date, calendar: WorkingCalendar = DEFAULT_CALENDAR): Date {
  assertHasWorkingDays(calendar.schedule);
  const cursor = utcDate(date);
  for (let i = 0; i < MAX_WALK; i++) {
    if (isWorkingDay(cursor, calendar)) return cursor;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  throw new Error("No working day found within a year; check the working schedule and holidays");
}

/**
 * Move `n` WORKING days from `date` (Offboarding semantics). `n = 0` snaps
 * forward to the next working day — a task is never due on a day off, and it
 * moves FORWARD so it is never overdue before the event it depends on.
 */
export function addWorkingDays(
  date: Date,
  n: number,
  calendar: WorkingCalendar = DEFAULT_CALENDAR,
): Date {
  assertHasWorkingDays(calendar.schedule);
  if (n === 0) return rollForward(date, calendar);
  const cursor = utcDate(date);
  const step = n < 0 ? -1 : 1;
  let remaining = Math.abs(n);
  let guard = 0;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + step);
    if (isWorkingDay(cursor, calendar)) remaining -= 1;
    if (++guard > MAX_WALK * 4) throw new Error("Working-day walk did not terminate");
  }
  return cursor;
}

/**
 * Move `n` CALENDAR days, then roll forward off a non-working day (Onboarding
 * `dueDateFrom`; also for negative offsets — a pre-boarding task falling on a
 * Friday is due the Sunday after, never the Thursday before).
 */
export function addCalendarDaysRolled(
  date: Date,
  n: number,
  calendar: WorkingCalendar = DEFAULT_CALENDAR,
): Date {
  const shifted = new Date(utcDate(date).getTime() + n * DAY_MS);
  return rollForward(shifted, calendar);
}

export type OffsetUnit = "CALENDAR_DAYS" | "WORKING_DAYS";

/** A due date from an anchor and an offset in the given unit. */
export function offsetDate(
  anchor: Date,
  offset: number,
  unit: OffsetUnit,
  calendar: WorkingCalendar = DEFAULT_CALENDAR,
): Date {
  return unit === "WORKING_DAYS"
    ? addWorkingDays(anchor, offset, calendar)
    : addCalendarDaysRolled(anchor, offset, calendar);
}

/**
 * Working days AFTER `from` up to and including `to` (same day = 0, next
 * working day = 1). Never negative: a deadline cannot be less than met.
 */
export function workingDaysBetween(
  from: Date,
  to: Date,
  calendar: WorkingCalendar = DEFAULT_CALENDAR,
): number {
  assertHasWorkingDays(calendar.schedule);
  const start = utcDate(from);
  const end = utcDate(to);
  if (end <= start) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isWorkingDay(cursor, calendar)) count += 1;
  }
  return count;
}

/**
 * Signed working days from `from` to `to`: positive when `to` is later,
 * negative when it is earlier (Onboarding statutory watch: "< 0 = overdue").
 */
export function signedWorkingDays(
  from: Date,
  to: Date,
  calendar: WorkingCalendar = DEFAULT_CALENDAR,
): number {
  return utcDate(to) >= utcDate(from)
    ? workingDaysBetween(from, to, calendar)
    : -workingDaysBetween(to, from, calendar);
}

// --- The send window (instants, in the schedule's time zone) ------------------

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Wall-clock parts of an instant in a zone (Intl — never the host's zone). */
function zonedParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; weekday: IsoWeekday } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Some ICU versions print "24" at midnight.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: (WEEKDAY_SHORT.indexOf(parts.weekday ?? "") + 1) as IsoWeekday,
  };
}

/** The UTC instant of a wall-clock time in a zone (offset measured, not assumed). */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const p = zonedParts(new Date(guess), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return new Date(guess + (guess - asUtc));
}

/** The calendar date (UTC midnight) an instant falls on in the schedule's zone. */
export function zonedToday(instant: Date, timeZone: string): Date {
  const p = zonedParts(instant, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day));
}

/** Inside the window: a working day (holidays included), start ≤ hour < end, in the zone. */
export function isWithinWindow(
  instant: Date,
  calendar: WorkingCalendar = DEFAULT_CALENDAR,
): boolean {
  const { schedule } = calendar;
  const p = zonedParts(instant, schedule.timeZone);
  if (!isWorkingDay(new Date(Date.UTC(p.year, p.month - 1, p.day)), calendar)) return false;
  return p.hour >= schedule.startHour && p.hour < schedule.endHour;
}

/**
 * When a message may be sent: now if inside the window, otherwise the next
 * opening (today's start if it is a working day and before opening, else the
 * next working day's start). Returns the SAME instant when inside the window.
 * Bounded: a schedule with no working days throws instead of spinning.
 */
export function nextWindowOpening(
  instant: Date,
  calendar: WorkingCalendar = DEFAULT_CALENDAR,
): Date {
  const { schedule } = calendar;
  assertHasWorkingDays(schedule);
  if (isWithinWindow(instant, calendar)) return instant;
  const zone = schedule.timeZone;
  const now = zonedParts(instant, zone);
  let day = new Date(Date.UTC(now.year, now.month - 1, now.day));
  if (!(isWorkingDay(day, calendar) && now.hour < schedule.startHour)) {
    day = new Date(day.getTime() + DAY_MS);
  }
  for (let i = 0; i < MAX_WALK; i++) {
    if (isWorkingDay(day, calendar)) {
      return zonedTimeToUtc(
        day.getUTCFullYear(),
        day.getUTCMonth() + 1,
        day.getUTCDate(),
        schedule.startHour,
        0,
        zone,
      );
    }
    day = new Date(day.getTime() + DAY_MS);
  }
  throw new Error("No working day found within a year; check the working schedule and holidays");
}

/** Is the local hour (in the schedule's zone) equal to `hour`? For "08:00 Muscat" jobs. */
export function isLocalHour(instant: Date, hour: number, timeZone: string): boolean {
  return zonedParts(instant, timeZone).hour === hour;
}
