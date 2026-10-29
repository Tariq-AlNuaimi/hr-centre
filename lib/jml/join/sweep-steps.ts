import { prisma } from "@/lib/prisma";
import {
  isLocalHour,
  workingDaysBetween,
  zonedTimeToUtc,
  zonedToday,
  type WorkingCalendar,
} from "@/lib/working-time/calendar";
import { desks } from "../desks";
import { queueEmail } from "../email/queue";
import { EMAIL_TYPES } from "../email/types";
import { notifyJml } from "../engine/notify";
import { SETTLED_TASK_STATUSES } from "../vocab";

/**
 * Scheduled joiner/mover work for the hourly sweep — HR Onboarding
 * `queueItReadinessReminders` and `queueOverdueDigests`, on the ONE calendar
 * (8.4.4: working days now honour the schedule and holidays).
 *
 * Fixed: the digest goes to each TASK owner (the case owner for unowned tasks),
 * so reassigned work is chased with the person doing it (8.4.7); it runs once
 * per Muscat day even if the sweep is triggered twice in the 08:00 hour.
 */

type Ctx = { now: Date; calendar: WorkingCalendar };

const IT_REMINDER_WORKING_DAYS = 2;
const IT_HORIZON_DAYS = 6;
const DIGEST_HOUR = 8;

function startOfLocalDay(now: Date, calendar: WorkingCalendar): Date {
  const today = zonedToday(now, calendar.schedule.timeZone);
  return zonedTimeToUtc(
    today.getUTCFullYear(),
    today.getUTCMonth() + 1,
    today.getUTCDate(),
    0,
    0,
    calendar.schedule.timeZone,
  );
}

/** IT setup still waiting within two working days of the start: one email per case per day. */
export async function itReadinessReminders({ now, calendar }: Ctx) {
  const it = await desks.it();
  if (!it) return { reminded: 0, skipped: "no-it-address" };
  const today = zonedToday(now, calendar.schedule.timeZone);
  const horizon = new Date(today.getTime() + IT_HORIZON_DAYS * 86_400_000);
  const dayStart = startOfLocalDay(now, calendar);
  const pending = await prisma.jmlTask.findMany({
    where: {
      status: "WAITING_FOR_IT",
      case: {
        caseType: "JOIN",
        status: "ACTIVE",
        joinDetail: { plannedStartDate: { gte: today, lte: horizon }, actualStartDate: null },
      },
      OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: dayStart } }],
    },
    select: {
      id: true,
      caseId: true,
      case: {
        select: {
          employee: { select: { name: true } },
          joinDetail: { select: { plannedStartDate: true } },
        },
      },
    },
    take: 200,
  });
  const byCase = new Map<string, { name: string; start: Date; taskIds: string[] }>();
  for (const t of pending) {
    const start = t.case.joinDetail?.plannedStartDate;
    if (!start || workingDaysBetween(today, start, calendar) > IT_REMINDER_WORKING_DAYS) continue;
    const entry = byCase.get(t.caseId) ?? { name: t.case.employee.name, start, taskIds: [] };
    entry.taskIds.push(t.id);
    byCase.set(t.caseId, entry);
  }
  for (const [caseId, entry] of byCase) {
    await queueEmail({
      type: EMAIL_TYPES.IT_REMINDER,
      recipient: it,
      subject: `IT setup outstanding: ${entry.name} starts ${entry.start.toISOString().slice(0, 10)}`,
      caseId,
    });
    for (const id of entry.taskIds) {
      await prisma.jmlTask.update({
        where: { id },
        data: { lastReminderAt: now },
        select: { id: true },
      });
    }
  }
  return { reminded: byCase.size, skipped: null };
}

/** 08:00 in the schedule's zone: each owner hears how many of their tasks are overdue. */
export async function overdueDigests({ now, calendar }: Ctx) {
  if (!isLocalHour(now, DIGEST_HOUR, calendar.schedule.timeZone)) return { skipped: "not-08:00" };
  const today = zonedToday(now, calendar.schedule.timeZone);
  const overdue = await prisma.jmlTask.findMany({
    where: {
      dueDate: { lt: today },
      status: { notIn: [...SETTLED_TASK_STATUSES] },
      case: { status: "ACTIVE", caseType: { in: ["JOIN", "MOVE"] } },
    },
    select: {
      owner: { select: { id: true, email: true } },
      case: { select: { hrOwner: { select: { id: true, email: true } } } },
    },
    take: 500,
  });
  const byOwner = new Map<string, { email: string; count: number }>();
  for (const t of overdue) {
    const who = t.owner ?? t.case.hrOwner;
    if (!who) continue;
    const entry = byOwner.get(who.id) ?? { email: who.email, count: 0 };
    entry.count += 1;
    byOwner.set(who.id, entry);
  }
  const dayStart = startOfLocalDay(now, calendar);
  const dayKey = today.toISOString().slice(0, 10);
  let sent = 0;
  for (const [userId, entry] of byOwner) {
    const plural = entry.count === 1 ? "" : "s";
    const already = await prisma.jmlEmailLog.findFirst({
      where: {
        type: EMAIL_TYPES.OVERDUE_DIGEST,
        recipient: entry.email,
        createdAt: { gte: dayStart },
      },
      select: { id: true },
    });
    if (!already) {
      await queueEmail({
        type: EMAIL_TYPES.OVERDUE_DIGEST,
        recipient: entry.email,
        subject: `${entry.count} overdue onboarding task${plural}`,
      });
      sent += 1;
    }
    await notifyJml(
      [
        {
          kind: "JML_OVERDUE_TASK_DIGEST",
          userIds: [userId],
          body: `${entry.count} overdue task${plural} on joiner and mover cases.`,
          href: "/jml/my-tasks",
          caseId: null,
          dedupeBase: `digest:${dayKey}`,
        },
      ],
      calendar,
      now,
    );
  }
  return { owners: byOwner.size, emailed: sent };
}
