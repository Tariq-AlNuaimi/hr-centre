import type { Prisma } from "@/generated/prisma/client";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { PROVIDER_LIMIT, type WorkItem, type WorkProvider } from "@/lib/core/work-items";
import { caseScopeWhere, jmlActor } from "./access";
import { SETTLED_TASK_STATUSES } from "./vocab";

/**
 * Joiners & leavers in Home's "My work" (docs/blueprints/ux-p0.md, US-1):
 *   - checklist tasks the viewer OWNS on a live case (assignment is the filter,
 *     the same rule as /jml/my-tasks);
 *   - approval decisions waiting to be recorded, for someone who holds
 *     `jml.decideApprovals` — only on cases in that permission's scope.
 */

const LIVE = ["ACTIVE", "AT_RISK", "PENDING_SETTLEMENT"] as const;

const humanize = (code: string) => code.replaceAll("_", " ").toLowerCase();

async function myTasks(userId: string) {
  const where: Prisma.JmlTaskWhereInput = {
    ownerUserId: userId,
    status: { notIn: [...SETTLED_TASK_STATUSES] },
    case: { status: { in: [...LIVE] } },
  };
  const [rows, total] = await Promise.all([
    prisma.jmlTask.findMany({
      where,
      // Nulls (no due date) after the dated ones.
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      take: PROVIDER_LIMIT,
      select: {
        id: true,
        code: true,
        name: true,
        dueDate: true,
        case: { select: { id: true, caseRef: true, employee: { select: { name: true } } } },
      },
    }),
    prisma.jmlTask.count({ where }),
  ]);
  const items: WorkItem[] = rows.map((t) => ({
    key: `jml-task:${t.id}`,
    module: "jml",
    kind: "jmlTask",
    params: { code: t.code, task: t.name, person: t.case.employee.name, caseRef: t.case.caseRef },
    dueAt: t.dueDate ? t.dueDate.toISOString() : null,
    href: `/jml/cases/${t.case.id}?tab=checklist`,
  }));
  return { items, total };
}

async function approvalsToRecord(session: Session) {
  const actor = await jmlActor(session);
  const scope = caseScopeWhere(actor, "jml.decideApprovals");
  if (scope === null) return { items: [], total: 0 };
  const where: Prisma.JmlApprovalWhereInput = {
    status: "PENDING",
    case: { ...scope, status: { in: [...LIVE] } },
  };
  const [rows, total] = await Promise.all([
    prisma.jmlApproval.findMany({
      where,
      orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
      take: PROVIDER_LIMIT,
      select: {
        id: true,
        approvalType: true,
        holderRoleKey: true,
        case: { select: { id: true, caseRef: true, employee: { select: { name: true } } } },
      },
    }),
    prisma.jmlApproval.count({ where }),
  ]);
  const items: WorkItem[] = rows.map((a) => ({
    key: `jml-approval:${a.id}`,
    module: "jml",
    kind: "jmlApproval",
    params: {
      approval: humanize(a.approvalType),
      holder: a.holderRoleKey.replaceAll("_", " "),
      person: a.case.employee.name,
      caseRef: a.case.caseRef,
    },
    dueAt: null,
    href: `/jml/cases/${a.case.id}?tab=approvals`,
  }));
  return { items, total };
}

export const jmlWorkProvider: WorkProvider = {
  module: "jml",
  async collect(session) {
    const [tasks, approvals] = await Promise.all([
      myTasks(session.user.id),
      approvalsToRecord(session),
    ]);
    return {
      items: [...tasks.items, ...approvals.items].slice(0, PROVIDER_LIMIT),
      total: tasks.total + approvals.total,
    };
  },
};
