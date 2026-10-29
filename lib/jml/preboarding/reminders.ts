import { env } from "@/lib/env";
import { isEmailEnabled } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { deleteStoredFile, isStorageConfigured } from "@/lib/storage";
import { issueMagicLink, magicLinkUrl } from "@/lib/core/tokens/magic-link";
import { zonedToday } from "@/lib/working-time/calendar";
import type { WorkingCalendar } from "@/lib/working-time/calendar";
import { notifyJml } from "../engine/notify";
import { PREBOARDING_PURPOSE, linkExpiry, reminderDue } from "./rules";
import { sendPreboardingEmail } from "./store";

const DAY_MS = 86_400_000;

// --- Sweep -----------------------------------------------------------------

/**
 * Reminder cadence: 10, 5 and 2 working days before the planned start, for a
 * joiner with a live link who has not submitted. The HR owner gets a bell; the
 * joiner gets a fresh link by email when SMTP is configured (the old link's raw
 * token is not stored, so a reminder cannot repeat it).
 */
export async function preboardingReminders({
  now,
  calendar,
}: {
  now: Date;
  calendar: WorkingCalendar;
}) {
  const today = zonedToday(now, calendar.schedule.timeZone);
  const startOfToday = new Date(now.getTime() - (now.getTime() % DAY_MS));
  const rows = await prisma.jmlPreboarding.findMany({
    where: {
      submittedAt: null,
      linkExpiresAt: { gt: now },
      case: {
        caseType: "JOIN",
        status: "ACTIVE",
        employee: { status: "PRE_JOINER" },
        joinDetail: { plannedStartDate: { gt: today } },
      },
    },
    select: {
      caseId: true,
      lastReminderAt: true,
      remindersSent: true,
      case: {
        select: {
          caseRef: true,
          hrOwnerUserId: true,
          joinDetail: { select: { plannedStartDate: true } },
          employee: {
            select: { name: true, personalEmail: true, entity: { select: { name: true } } },
          },
        },
      },
    },
    take: 200,
  });
  let reminded = 0;
  let emailed = 0;
  for (const row of rows) {
    const start = row.case.joinDetail?.plannedStartDate;
    if (!start) continue;
    if (
      !reminderDue({
        today,
        plannedStart: start,
        lastReminderAt: row.lastReminderAt,
        startOfToday,
        calendar,
      })
    ) {
      continue;
    }
    await prisma.jmlPreboarding.update({
      where: { caseId: row.caseId },
      data: { lastReminderAt: now, remindersSent: { increment: 1 } },
      select: { caseId: true },
    });
    if (row.case.hrOwnerUserId) {
      await notifyJml(
        [
          {
            kind: "JML_INFO",
            userIds: [row.case.hrOwnerUserId],
            body: `${row.case.employee.name} has not completed their preboarding form yet (${row.case.caseRef}, starts ${start.toISOString().slice(0, 10)}).`,
            href: `/jml/cases/${row.caseId}?tab=overview`,
            caseId: row.caseId,
            dedupeBase: `preboarding-reminder:${row.caseId}:${today.toISOString().slice(0, 10)}`,
          },
        ],
        calendar,
        now,
      );
    }
    reminded += 1;
    if (env.AUTH_URL && row.case.employee.personalEmail && isEmailEnabled()) {
      const raw = await issueMagicLink({
        purpose: PREBOARDING_PURPOSE,
        subjectId: row.caseId,
        ttlMs: Math.max(linkExpiry(now, start).getTime() - now.getTime(), DAY_MS),
      });
      const sent = await sendPreboardingEmail(
        row.case.employee,
        magicLinkUrl(env.AUTH_URL, "preboarding", raw),
        start,
      );
      if (sent.sent) emailed += 1;
    }
  }
  return { scanned: rows.length, reminded, emailed };
}

/** Retention: the picture goes with the anonymised case (called after the row is gone). */
export async function erasePreboardingPhoto(pathname: string | null) {
  if (pathname && isStorageConfigured()) await deleteStoredFile(pathname).catch(() => undefined);
}
