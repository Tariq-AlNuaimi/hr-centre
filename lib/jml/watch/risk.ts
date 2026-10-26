import { signedWorkingDays, type WorkingCalendar } from "@/lib/working-time/calendar";

/** Statutory risk banding (BR-025), in working days of the ONE calendar. Pure. */
export type StatutoryRisk = "overdue" | "no_deadline" | "due_soon" | "scheduled";

const DUE_SOON_WORKING_DAYS = 5;
export const RISK_ORDER: Record<StatutoryRisk, number> = {
  overdue: 0,
  no_deadline: 1,
  due_soon: 2,
  scheduled: 3,
};

export function statutoryRisk(
  deadline: Date | null,
  today: Date,
  calendar: WorkingCalendar,
): { risk: StatutoryRisk; workingDays: number | null } {
  if (!deadline) return { risk: "no_deadline", workingDays: null };
  const days = signedWorkingDays(today, deadline, calendar);
  if (days < 0) return { risk: "overdue", workingDays: days };
  return { risk: days <= DUE_SOON_WORKING_DAYS ? "due_soon" : "scheduled", workingDays: days };
}
