import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { signedWorkingDays, zonedToday } from "@/lib/working-time/calendar";
import { loadWorkingCalendar } from "@/lib/working-time/load";
import { canFor, caseScopeWhere, holdsAnywhere, subjectOf, type JmlActor } from "./access";
import { myTaskWhere } from "./routing/worker";
import { BUCKET_ORDER, defaultMine, workBucket } from "./dashboard-rules";
import { SETTLED_TASK_STATUSES } from "./vocab";

/**
 * The JML dashboard — Onboarding's dashboard and Offboarding Module 11 as one
 * screen: live cases by type, this month's joiners and exits, average
 * completion, my work, awaiting approval, statutory watch (joiners' statutory
 * tasks and leavers' visa cancellation), delayed tasks and this month's exit
 * reasons. Every panel is capped at 50 and scoped; by default a case owner
 * sees their own cases (AC-13.5) and can widen to everything they may see.
 */

const LIVE = ["ACTIVE", "AT_RISK", "PENDING_SETTLEMENT"] as const;
const PANEL = 50;

function monthBounds(today: Date) {
  return {
    from: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
    to: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)),
  };
}

async function counts(where: Prisma.JmlCaseWhereInput, today: Date) {
  const { from, to } = monthBounds(today);
  const live = { ...where, status: { in: [...LIVE] } };
  const [byType, joiningThisMonth, exitsThisMonth, avg] = await Promise.all([
    prisma.jmlCase.groupBy({ by: ["caseType"], where: live, _count: { _all: true } }),
    prisma.jmlCase.count({
      where: {
        ...where,
        caseType: "JOIN",
        status: { notIn: ["CANCELLED", "ARCHIVED"] },
        joinDetail: { plannedStartDate: { gte: from, lt: to } },
      },
    }),
    prisma.jmlCase.count({
      where: {
        ...where,
        caseType: "LEAVE",
        cancelledAt: null,
        status: { notIn: ["DRAFT", "CANCELLED"] },
        leaveDetail: { lastDayOfService: { gte: from, lt: to } },
      },
    }),
    prisma.jmlCase.aggregate({ where: live, _avg: { completionPct: true } }),
  ]);
  const of = (t: string) => byType.find((b) => b.caseType === t)?._count._all ?? 0;
  return {
    liveJoiners: of("JOIN"),
    liveMovers: of("MOVE"),
    liveLeavers: of("LEAVE"),
    joiningThisMonth,
    exitsThisMonth,
    averageCompletion: avg._avg.completionPct === null ? null : Math.round(avg._avg.completionPct),
  };
}

const TASK_ROW = {
  id: true,
  code: true,
  name: true,
  dueDate: true,
  status: true,
  case: {
    select: { id: true, caseRef: true, caseType: true, employee: { select: { name: true } } },
  },
} as const;

/** What My tasks needs to complete a task in place (routed workers cannot open the case). */
const MY_TASK_ROW = {
  ...TASK_ROW,
  version: true,
  assigneeRole: true,
  confirmationRequired: true,
  confirmingParty: true,
  confirmationDate: true,
  externalReference: true,
  case: {
    select: {
      ...TASK_ROW.case.select,
      employee: {
        select: {
          name: true,
          entityId: true,
          departmentId: true,
          department: { select: { directorateId: true } },
        },
      },
    },
  },
} as const;

/**
 * My tasks: what I own plus what is routed to me (task routing — desk and
 * line-manager tasks). `canOpenCase` says whether the case page will open for
 * me; a routed worker without `jml.view` there works the task from this list.
 */
export async function myTasks(actor: JmlActor, caseType?: "JOIN" | "MOVE" | "LEAVE") {
  const calendar = await loadWorkingCalendar();
  const today = zonedToday(new Date(), calendar.schedule.timeZone);
  const rows = await prisma.jmlTask.findMany({
    where: {
      AND: [
        await myTaskWhere(actor),
        { status: { notIn: [...SETTLED_TASK_STATUSES] } },
        { case: { status: { in: [...LIVE, "CANCELLED"] }, ...(caseType ? { caseType } : {}) } },
      ],
    },
    orderBy: [{ dueDate: "asc" }],
    select: MY_TASK_ROW,
    take: 200,
  });
  return rows
    .map(({ case: { employee, ...kase }, ...t }) => ({
      ...t,
      case: { ...kase, employee: { name: employee.name } },
      canOpenCase: canFor(actor, "jml.view", subjectOf(employee)),
      bucket: workBucket(t.dueDate, today),
    }))
    .sort((a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket]);
}

async function statutoryWatch(where: Prisma.JmlCaseWhereInput, today: Date) {
  const calendar = await loadWorkingCalendar();
  const [joiners, leavers] = await Promise.all([
    prisma.jmlTask.findMany({
      where: {
        statutory: true,
        status: { notIn: [...SETTLED_TASK_STATUSES] },
        case: { ...where, status: { in: [...LIVE] } },
      },
      select: { ...TASK_ROW, complianceDeadline: true },
      orderBy: { complianceDeadline: "asc" },
      take: PANEL,
    }),
    prisma.jmlCase.findMany({
      where: {
        ...where,
        caseType: "LEAVE",
        status: { in: [...LIVE] },
        leaveDetail: { nationality: "EXPATRIATE", departureDate: { not: null } },
        gateRecords: { none: { gateId: "C7", satisfied: true } },
      },
      select: {
        id: true,
        caseRef: true,
        employee: { select: { name: true } },
        leaveDetail: { select: { departureDate: true } },
      },
      take: PANEL,
    }),
  ]);
  const items = [
    ...joiners
      .filter((t) => t.complianceDeadline)
      .map((t) => ({
        caseId: t.case.id,
        caseRef: t.case.caseRef,
        name: t.case.employee.name,
        what: `${t.code} ${t.name}`,
        daysLeft: signedWorkingDays(today, t.complianceDeadline!, calendar),
      })),
    ...leavers.map((c) => ({
      caseId: c.id,
      caseRef: c.caseRef,
      name: c.employee.name,
      what: "VISA_CANCELLATION",
      daysLeft: signedWorkingDays(today, c.leaveDetail!.departureDate!, calendar),
    })),
  ];
  return items
    .filter((i) => i.daysLeft <= 3)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, PANEL);
}

export async function jmlDashboard(actor: JmlActor, scope: "mine" | "all" | undefined) {
  const base = caseScopeWhere(actor, "jml.view");
  if (base === null) return null;
  const mine = defaultMine(holdsAnywhere(actor, "jml.supervise"), scope);
  const where: Prisma.JmlCaseWhereInput = {
    AND: [base, mine ? { hrOwnerUserId: actor.userId } : {}],
  };
  const calendar = await loadWorkingCalendar();
  const today = zonedToday(new Date(), calendar.schedule.timeZone);
  const { from, to } = monthBounds(today);
  const [summary, work, approvals, watch, delayed, reasons] = await Promise.all([
    counts(where, today),
    myTasks(actor),
    prisma.jmlApproval.findMany({
      where: { status: "PENDING", case: { AND: [where, { status: { in: [...LIVE, "DRAFT"] } }] } },
      orderBy: { requestedAt: "asc" },
      select: {
        id: true,
        approvalType: true,
        holderRoleKey: true,
        requestedAt: true,
        case: { select: { id: true, caseRef: true, employee: { select: { name: true } } } },
      },
      take: PANEL,
    }),
    statutoryWatch(where, today),
    prisma.jmlTask.findMany({
      where: {
        dueDate: { lt: today },
        status: { notIn: [...SETTLED_TASK_STATUSES] },
        case: { ...where, status: { in: [...LIVE] } },
      },
      orderBy: { dueDate: "asc" },
      select: { ...TASK_ROW, owner: { select: { name: true } } },
      take: PANEL,
    }),
    prisma.jmlExitInterview.groupBy({
      by: ["primaryL1"],
      where: { case: { ...where, leaveDetail: { lastDayOfService: { gte: from, lt: to } } } },
      _count: { _all: true },
    }),
  ]);
  return {
    scope: mine ? "mine" : "all",
    summary,
    // The panel is a glance; My tasks holds the full list.
    myWork: work.slice(0, 10),
    myWorkTotal: work.length,
    awaitingApproval: approvals,
    statutoryWatch: watch,
    delayedTasks: delayed,
    exitReasons: reasons
      .map((r) => ({ level1: r.primaryL1, exits: r._count._all }))
      .sort((a, b) => b.exits - a.exits),
  };
}
