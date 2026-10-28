import { prisma } from "@/lib/prisma";
import { loadWorkingCalendar } from "@/lib/working-time/load";
import type { WorkingCalendar } from "@/lib/working-time/calendar";
import { drainQueue } from "./email/queue";
import { notifyJml } from "./engine/notify";
import { runRetention } from "./join/retention";
import { itReadinessReminders, overdueDigests } from "./join/sweep-steps";
import { applyDueMoves } from "./move/apply";
import { reconcileLineManagerTasks } from "./routing/assign";
import { leaveDailyNotices, leaveDepartures, leaveHealthRefresh } from "./leave/sweep-steps";
import { isLocalHour } from "@/lib/working-time/calendar";

/**
 * The JML sweep — ONE hourly scheduled job (`/api/internal/jml-sweep`, Vercel
 * cron at :10) for everything the two source apps scheduled or forgot to:
 * Onboarding's hourly scheduler (email drain, failure alerts, IT reminders,
 * 08:00 digest) and retention, and Offboarding's notification sweep plus the
 * jobs it never scheduled (F3 digests/escalations/reminders/alerts, F16
 * incident scan) and the departure triggers (D7). Each step runs in its own
 * try/catch: one failing step never costs the others their run.
 */

export type SweepStep = {
  name: string;
  run: (ctx: { now: Date; calendar: WorkingCalendar }) => Promise<unknown>;
};

/** AC-7.4: a FAILED message with a case tells the case owner, once per case and type. */
async function alertFailedEmails({ calendar, now }: { now: Date; calendar: WorkingCalendar }) {
  const failed = await prisma.jmlEmailLog.findMany({
    where: { status: "FAILED", caseId: { not: null } },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      type: true,
      caseId: true,
      case: { select: { caseRef: true, hrOwnerUserId: true } },
    },
  });
  const notices = failed
    .filter((f) => f.case?.hrOwnerUserId)
    .map((f) => ({
      kind: "JML_AUTOMATION_FAILURE" as const,
      userIds: [f.case!.hrOwnerUserId!],
      body: `A ${f.type} message could not be sent (${f.case!.caseRef}). Open the case's emails to retry it.`,
      href: `/jml/cases/${f.caseId}?tab=emails`,
      caseId: f.caseId,
      dedupeBase: `email-failed:${f.caseId}:${f.type}`,
    }));
  return notifyJml(notices, calendar, now);
}

const SWEEP_STEPS: SweepStep[] = [
  { name: "emailDrain", run: ({ now }) => drainQueue(now) },
  { name: "failedEmailAlerts", run: alertFailedEmails },
  { name: "itReadinessReminders", run: itReadinessReminders },
  { name: "overdueDigests", run: overdueDigests },
  { name: "moveEffective", run: applyDueMoves },
  // Task routing D6: after any writer moved a reporting line (import, roll-up,
  // transfer, a move that just applied), open LINE_MANAGER tasks follow it.
  { name: "lineManagerTasks", run: () => reconcileLineManagerTasks() },
  { name: "leaveDepartures", run: leaveDepartures },
  { name: "leaveHealth", run: leaveHealthRefresh },
  { name: "leaveDailyNotices", run: leaveDailyNotices },
  {
    // Daily, 03:00 in the schedule's zone (Onboarding ran it at 02:00 UTC).
    name: "joinRetention",
    run: ({ now, calendar }) =>
      isLocalHour(now, 3, calendar.schedule.timeZone)
        ? runRetention(now)
        : Promise.resolve({ skipped: "not-03:00" }),
  },
];

export async function runSweep(now = new Date(), steps: readonly SweepStep[] = SWEEP_STEPS) {
  const calendar = await loadWorkingCalendar(now);
  const results: Record<string, unknown> = {};
  for (const step of steps) {
    try {
      results[step.name] = await step.run({ now, calendar });
    } catch (e) {
      results[step.name] = { error: e instanceof Error ? e.message.slice(0, 300) : "failed" };
    }
  }
  return { ranAt: now.toISOString(), results };
}
