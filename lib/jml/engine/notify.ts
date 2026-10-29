import type { NotificationKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { persistNotifications, type PendingNotification } from "@/lib/core/notify/store";
import { nextWindowOpening, type WorkingCalendar } from "@/lib/working-time/calendar";

/**
 * The one notification mechanism (D6): JML writes the core `Notification`
 * (the header bell), addressed to HR LOGINS and delivered to their employee
 * record (the feed is per employee — a login with no employee record has no
 * feed, the platform's existing rule). Outside the working window the row is
 * written with `sendAfter` = the next opening, evaluated in the schedule's
 * zone (Offboarding F2 fixed) — queued, never dropped.
 *
 * Offboarding AC-18.2: recipients are internal HR users only — this helper
 * cannot address an employee who has no HR login.
 */

export type JmlNotice = {
  kind: NotificationKind;
  userIds: readonly string[];
  body: string;
  href: string | null;
  caseId: string | null;
  /** Stable identity of the event; the recipient is appended per row. */
  dedupeBase: string;
};

const MAX_RECIPIENTS = 50;

export async function notifyJml(
  notices: readonly JmlNotice[],
  calendar: WorkingCalendar,
  now: Date = new Date(),
): Promise<{ written: number; duplicates: number; failed: number }> {
  const userIds = [...new Set(notices.flatMap((n) => n.userIds.slice(0, MAX_RECIPIENTS)))];
  if (userIds.length === 0) return { written: 0, duplicates: 0, failed: 0 };
  const links = await prisma.employee.findMany({
    where: { userId: { in: userIds } },
    select: { id: true, userId: true },
    take: userIds.length,
  });
  const employeeOf = new Map(links.map((l) => [l.userId!, l.id]));
  const opening = nextWindowOpening(now, calendar);
  const sendAfter = opening.getTime() === now.getTime() ? null : opening;
  const pending: PendingNotification[] = [];
  for (const n of notices) {
    for (const userId of new Set(n.userIds.slice(0, MAX_RECIPIENTS))) {
      const employeeId = employeeOf.get(userId);
      if (!employeeId) continue;
      pending.push({
        recipientEmployeeId: employeeId,
        kind: n.kind,
        body: n.body,
        href: n.href,
        dedupeKey: `jml:${n.dedupeBase}:${employeeId}`,
        caseId: n.caseId,
        sendAfter,
      });
    }
  }
  const r = await persistNotifications(pending, 2000);
  return { written: r.written, duplicates: r.duplicates, failed: r.failed };
}
