import type { JmlTaskStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { usersHoldingPermission } from "@/lib/rbac/resolve";
import {
  isLocalHour,
  signedWorkingDays,
  workingDaysBetween,
  zonedToday,
  type WorkingCalendar,
} from "@/lib/working-time/calendar";
import { subjectOf } from "../access";
import { notifyJml, type JmlNotice } from "../engine/notify";
import { SETTLED_TASK_STATUSES } from "../vocab";
import { needsReminder } from "./approval-rules";
import { detectIncidents, INCIDENT_KINDS } from "./compliance";
import { ESCALATION_WORKING_DAYS, STATUTORY_WATCH_WORKING_DAYS, leaveHealth } from "./health";

/**
 * Scheduled leaver work (Offboarding F3/F4/F16): every automated notice the
 * source app defined but never sent, plus case health and the incident scan.
 * All in the core feed (D6), internal HR users only, deduplicated per day.
 */

type Ctx = { now: Date; calendar: WorkingCalendar };

const LIVE = ["ACTIVE", "AT_RISK", "PENDING_SETTLEMENT"] as const;

const LIVE_CASES = {
  id: true,
  caseRef: true,
  status: true,
  stage: true,
  ragFlag: true,
  hrOwnerUserId: true,
  seniorHrUserId: true,
  employee: {
    select: {
      name: true,
      entityId: true,
      departmentId: true,
      department: { select: { directorateId: true } },
    },
  },
  leaveDetail: {
    select: {
      settlementApplicable: true,
      nationality: true,
      departureDate: true,
      lastDayOfService: true,
      migrated: true,
    },
  },
  tasks: {
    where: {
      status: { notIn: [...SETTLED_TASK_STATUSES] as JmlTaskStatus[] },
      dueDate: { not: null },
    },
    select: { id: true, code: true, name: true, dueDate: true, ownerUserId: true },
    take: 300,
  },
  gateRecords: { where: { gateId: "C7" }, select: { satisfied: true, satisfiedAt: true }, take: 1 },
} as const;

async function liveLeaveCases() {
  return prisma.jmlCase.findMany({
    where: { caseType: "LEAVE", status: { in: [...LIVE] } },
    select: LIVE_CASES,
    orderBy: { createdAt: "asc" },
    take: 500,
  });
}

type LiveCase = Awaited<ReturnType<typeof liveLeaveCases>>[number];

/** Working days left to the visa-cancellation deadline (expatriates, until C7 is satisfied). */
function statutoryDaysLeft(c: LiveCase, today: Date, calendar: WorkingCalendar): number | null {
  const d = c.leaveDetail;
  if (!d || d.nationality !== "EXPATRIATE" || !d.departureDate) return null;
  if (c.gateRecords[0]?.satisfied) return null;
  return signedWorkingDays(today, d.departureDate, calendar);
}

const owners = (c: LiveCase) =>
  [c.hrOwnerUserId, c.seniorHrUserId].filter((x): x is string => Boolean(x));

/** Hourly: RAG + AT_RISK / PENDING_SETTLEMENT; an audited write only when something changed. */
export async function leaveHealthRefresh({ now, calendar }: Ctx) {
  const today = zonedToday(now, calendar.schedule.timeZone);
  let changed = 0;
  for (const c of await liveLeaveCases()) {
    const next = leaveHealth({
      status: c.status,
      stage: c.stage,
      settlementApplicable: c.leaveDetail?.settlementApplicable ?? false,
      overdueWorkingDays: c.tasks.map((t) =>
        t.dueDate! < today ? workingDaysBetween(t.dueDate!, today, calendar) : 0,
      ),
      statutoryDaysLeft: statutoryDaysLeft(c, today, calendar),
    });
    if (next.ragFlag === c.ragFlag && next.status === c.status) continue;
    await prisma.jmlCase.update({ where: { id: c.id }, data: next, select: { id: true } });
    changed += 1;
  }
  return { changed };
}

/** 08:00 local, daily: digests, escalations, statutory alerts, approval reminders, incident scan. */
export async function leaveDailyNotices({ now, calendar }: Ctx) {
  if (!isLocalHour(now, 8, calendar.schedule.timeZone)) return { skipped: "not-08:00" };
  const today = zonedToday(now, calendar.schedule.timeZone);
  const day = today.toISOString().slice(0, 10);
  const cases = await liveLeaveCases();
  const notices: JmlNotice[] = [];
  const digest = new Map<string, number>();
  for (const c of cases) {
    for (const t of c.tasks) {
      if (!(t.dueDate! < today)) continue;
      const who = t.ownerUserId ?? c.hrOwnerUserId;
      if (who) digest.set(who, (digest.get(who) ?? 0) + 1);
      const late = workingDaysBetween(t.dueDate!, today, calendar);
      if (late > ESCALATION_WORKING_DAYS) {
        notices.push({
          kind: "JML_OVERDUE_ESCALATION",
          userIds: owners(c),
          body: `${c.caseRef} (${c.employee.name}): ${t.code} ${t.name} is ${late} working days overdue.`,
          href: `/jml/cases/${c.id}`,
          caseId: c.id,
          dedupeBase: `escalation:${t.id}:${day}`,
        });
      }
    }
    const left = statutoryDaysLeft(c, today, calendar);
    if (left !== null && left <= STATUTORY_WATCH_WORKING_DAYS) {
      const managers = await usersHoldingPermission("jml.overrideGates", subjectOf(c.employee), {
        limit: 20,
      });
      notices.push({
        kind: "JML_STATUTORY_WATCH_ALERT",
        userIds: [...owners(c).slice(0, 1), ...managers],
        body:
          left < 0
            ? `${c.caseRef}: the visa cancellation deadline passed ${-left} working days ago.`
            : `${c.caseRef}: ${left} working days to the visa cancellation deadline.`,
        href: `/jml/cases/${c.id}?tab=compliance`,
        caseId: c.id,
        dedupeBase: `statutory:${c.id}:${day}`,
      });
    }
  }
  for (const [userId, count] of digest) {
    notices.push({
      kind: "JML_OVERDUE_TASK_DIGEST",
      userIds: [userId],
      body: `${count} overdue task${count === 1 ? "" : "s"} on exit cases.`,
      href: "/jml/my-tasks",
      caseId: null,
      dedupeBase: `leave-digest:${day}`,
    });
  }
  notices.push(...(await approvalReminders(now, calendar, day)));
  const written = await notifyJml(notices, calendar, now);
  const incidents = await incidentScan(now);
  return { notices: notices.length, ...written, incidents };
}

async function approvalReminders(
  now: Date,
  calendar: WorkingCalendar,
  day: string,
): Promise<JmlNotice[]> {
  const pending = await prisma.jmlApproval.findMany({
    where: { status: "PENDING", case: { status: { in: [...LIVE, "DRAFT"] } } },
    select: {
      id: true,
      status: true,
      requestedAt: true,
      approvalType: true,
      holderRoleKey: true,
      case: {
        select: {
          id: true,
          caseRef: true,
          hrOwnerUserId: true,
          employee: {
            select: {
              entityId: true,
              departmentId: true,
              department: { select: { directorateId: true } },
            },
          },
        },
      },
    },
    take: 300,
  });
  const out: JmlNotice[] = [];
  for (const a of pending) {
    if (!needsReminder(a, now, (f, t) => workingDaysBetween(f, t, calendar))) continue;
    const deciders = await usersHoldingPermission(
      "jml.decideApprovals",
      subjectOf(a.case.employee),
      { limit: 10 },
    );
    out.push({
      kind: "JML_APPROVAL_REMINDER",
      userIds: [...(a.case.hrOwnerUserId ? [a.case.hrOwnerUserId] : []), ...deciders],
      body: `${a.case.caseRef}: the ${a.holderRoleKey} decision on ${a.approvalType.replaceAll("_", " ").toLowerCase()} has been pending more than 2 working days.`,
      href: `/jml/cases/${a.case.id}?tab=approvals`,
      caseId: a.case.id,
      dedupeBase: `approval:${a.id}:${day}`,
    });
  }
  return out;
}

/**
 * AC-12.2 / F16: logged daily for every non-migrated case, whatever its status.
 * C7 (visa cancellation) here; C5 (payment window) joins when the settlement
 * exists (S6, `settlementIncidentInput`).
 */
export async function incidentScan(now: Date) {
  const rows = await prisma.leaveCaseDetail.findMany({
    where: {
      migrated: false,
      nationality: "EXPATRIATE",
      departureDate: { not: null },
      case: { status: { notIn: ["DRAFT", "ARCHIVED"] } },
    },
    select: {
      caseId: true,
      nationality: true,
      departureDate: true,
      lastDayOfService: true,
      case: {
        select: {
          gateRecords: {
            where: { gateId: "C7" },
            select: { satisfied: true, satisfiedAt: true },
            take: 1,
          },
        },
      },
    },
    take: 1000,
  });
  let logged = 0;
  for (const r of rows) {
    const c7 = r.case.gateRecords[0];
    const found = detectIncidents(
      {
        lastDayOfService: r.lastDayOfService,
        paymentConfirmedAt: null,
        settlementApplicable: false,
        paymentWindowDays: null,
        nationality: r.nationality,
        departureDate: r.departureDate,
        visaCancellationConfirmedAt: c7?.satisfied ? c7.satisfiedAt : null,
      },
      now,
    );
    for (const i of found) {
      const existing = await prisma.leaveComplianceIncident.findUnique({
        where: {
          caseId_kind_deadlineAt: { caseId: r.caseId, kind: i.kind, deadlineAt: i.deadlineAt },
        },
        select: { id: true, daysLate: true },
      });
      if (existing) {
        if (existing.daysLate !== i.daysLate && !c7?.satisfied) {
          await prisma.leaveComplianceIncident.update({
            where: { id: existing.id },
            data: { daysLate: i.daysLate },
            select: { id: true },
          });
        }
        continue;
      }
      await prisma.leaveComplianceIncident.create({
        data: {
          caseId: r.caseId,
          kind: i.kind,
          gateId: i.gateId,
          detectedAt: now,
          deadlineAt: i.deadlineAt,
          daysLate: i.daysLate,
          note: INCIDENT_KINDS[i.kind].label,
        },
        select: { id: true },
      });
      logged += 1;
    }
  }
  return { scanned: rows.length, logged };
}
