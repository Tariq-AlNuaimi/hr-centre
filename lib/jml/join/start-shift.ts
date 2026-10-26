import {
  addCalendarDaysRolled,
  offsetDate,
  type WorkingCalendar,
} from "@/lib/working-time/calendar";

type ShiftTask = {
  id: string;
  dateBasis: string | null;
  offsetDays: number | null;
  offsetUnit: "CALENDAR_DAYS" | "WORKING_DAYS" | null;
  dueDate: Date | null;
  dueDateOverrideReason: string | null;
  statutory: boolean;
};

/**
 * Where a task goes when the start moves: a template task keyed to the start
 * is recomputed from its offset on the ONE calendar; a manual or overridden
 * task moves by the same number of days, rolled off non-working days.
 */
export function shiftedDue(
  t: ShiftTask,
  newStart: Date,
  shiftDays: number,
  calendar: WorkingCalendar,
): Date | null {
  if (!t.dueDate) return null;
  if (
    t.dateBasis === "START_DATE" &&
    t.offsetDays !== null &&
    t.offsetUnit &&
    !t.dueDateOverrideReason
  ) {
    return offsetDate(newStart, t.offsetDays, t.offsetUnit, calendar);
  }
  return addCalendarDaysRolled(t.dueDate, shiftDays, calendar);
}
