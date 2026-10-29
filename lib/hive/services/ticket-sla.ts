import { addWorkingHours } from "@/lib/working-time/calendar";
import { loadWorkingCalendar } from "@/lib/working-time/load";
import { readModuleSetting } from "@/lib/core/settings/store";
import { DEFAULT_RESPONSE_HOURS } from "@/lib/validations/hive/ticket-settings";

/**
 * HR tickets' internal clock and ownership (UX review tickets P1-2,
 * docs/blueprints/ux-p1-tickets.md): every new ticket gets an answer-by time
 * counted in WORKING hours on the core calendar (ADR-077), shown to HR as an
 * ageing badge and never to the employee (blueprint hive.md keeps employee-
 * facing SLA wording out).
 */

/** When a ticket raised at `now` should be answered by. Never throws — null when unknown. */
export async function answerDueAt(now: Date = new Date()): Promise<Date | null> {
  try {
    const stored = await readModuleSetting("tickets", "responseHours");
    const calendar = await loadWorkingCalendar(now);
    const hours =
      typeof stored === "number" && Number.isInteger(stored) && stored > 0
        ? stored
        : DEFAULT_RESPONSE_HOURS;
    return addWorkingHours(now, hours, calendar);
  } catch {
    return null;
  }
}
