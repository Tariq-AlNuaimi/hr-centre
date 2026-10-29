import { prisma } from "@/lib/prisma";
import { addWorkingHours } from "@/lib/working-time/calendar";
import { loadWorkingCalendar } from "@/lib/working-time/load";
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
    const [settings, calendar] = await Promise.all([
      prisma.hiveTicketSettings.findUnique({
        where: { id: "singleton" },
        select: { responseHours: true },
      }),
      loadWorkingCalendar(now),
    ]);
    return addWorkingHours(now, settings?.responseHours ?? DEFAULT_RESPONSE_HOURS, calendar);
  } catch {
    return null;
  }
}
