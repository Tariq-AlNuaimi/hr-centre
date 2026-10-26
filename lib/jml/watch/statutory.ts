import { prisma } from "@/lib/prisma";
import { zonedToday } from "@/lib/working-time/calendar";
import { loadWorkingCalendar } from "@/lib/working-time/load";
import { caseScopeWhere, type JmlActor } from "../access";
import { LIVE_CASE_STATUSES, SETTLED_TASK_STATUSES } from "../vocab";
import { RISK_ORDER, statutoryRisk } from "./risk";

/**
 * Statutory & visa watch — HR Onboarding `statutory.ts:106` (FR-DASH-008,
 * BR-025), for every case type, counted in working days of the ONE calendar.
 */

export async function statutoryWatch(
  actor: JmlActor,
  opts: { mine: boolean; includeScheduled: boolean },
  now = new Date(),
) {
  const scope = caseScopeWhere(actor, "jml.view");
  if (scope === null) return [];
  const calendar = await loadWorkingCalendar(now);
  const today = zonedToday(now, calendar.schedule.timeZone);
  const tasks = await prisma.jmlTask.findMany({
    where: {
      statutory: true,
      status: { notIn: [...SETTLED_TASK_STATUSES] },
      case: { AND: [scope, { status: { in: [...LIVE_CASE_STATUSES] } }] },
      ...(opts.mine
        ? { OR: [{ ownerUserId: actor.userId }, { case: { hrOwnerUserId: actor.userId } }] }
        : {}),
    },
    select: {
      id: true,
      name: true,
      status: true,
      complianceCategory: true,
      complianceDeadline: true,
      dueDate: true,
      caseId: true,
      case: {
        select: {
          caseRef: true,
          caseType: true,
          employee: { select: { name: true } },
          hrOwner: { select: { name: true } },
        },
      },
    },
    take: 200,
  });
  return tasks
    .map((t) => {
      const deadline = t.complianceDeadline ?? t.dueDate;
      const { risk, workingDays } = statutoryRisk(deadline, today, calendar);
      return {
        taskId: t.id,
        caseId: t.caseId,
        caseRef: t.case.caseRef,
        caseType: t.case.caseType,
        employee: t.case.employee.name,
        task: t.name,
        category: t.complianceCategory,
        deadline: deadline ? deadline.toISOString().slice(0, 10) : null,
        workingDays,
        hrOwner: t.case.hrOwner?.name ?? null,
        risk,
        status: t.status,
      };
    })
    .filter((r) => opts.includeScheduled || r.risk !== "scheduled")
    .sort(
      (a, b) =>
        RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || (a.workingDays ?? 0) - (b.workingDays ?? 0),
    );
}
