import type { JmlAssigneeRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyUsers } from "@/lib/notifications/user-notify";
import { LIVE_CASE_STATUSES, SETTLED_TASK_STATUSES } from "../vocab";
import { deskMembers, staffedDesks } from "./desks";
import { deskOf, routingWarnings, type RoutingContext, type RoutingWarning } from "./rules";

/**
 * Task routing at generation time and afterwards (docs/blueprints/
 * jml-task-routing.md): the routing context a case's tasks are resolved
 * against, the "assigned to you" notices, and the line-manager reconciliation
 * that follows a change of `Employee.managerId`.
 */

type EmployeeReader = Pick<typeof prisma, "employee">;

const MANAGER_SELECT = { userId: true, deletedAt: true, status: true } as const;

/** A manager routes to their login while they are on file and have not left. */
export function managerLogin(
  m: { userId: string | null; deletedAt: Date | null; status: string } | null | undefined,
): string | null {
  return m && !m.deletedAt && m.status !== "LEAVER" ? m.userId : null;
}

/** The login of an employee's current line manager, or null. */
async function lineManagerUserOf(client: EmployeeReader, employeeId: string) {
  const row = await client.employee.findUnique({
    where: { id: employeeId },
    select: { manager: { select: MANAGER_SELECT } },
  });
  return managerLogin(row?.manager);
}

/** Everything `resolveTaskOwner` needs for one case. */
export async function routingContextFor(
  client: EmployeeReader,
  employeeId: string,
  hrOwnerUserId: string | null,
): Promise<RoutingContext> {
  const [lineManagerUserId, members] = await Promise.all([
    lineManagerUserOf(client, employeeId),
    deskMembers(),
  ]);
  return { hrOwnerUserId, lineManagerUserId, staffedDesks: staffedDesks(members) };
}

const OPEN = { status: { notIn: [...SETTLED_TASK_STATUSES] } };

/** The live setup warnings for one case (US-5). */
export async function caseRoutingWarnings(caseId: string, employeeId: string) {
  const rows = await prisma.jmlTask.groupBy({
    by: ["assigneeRole"],
    where: { caseId, ...OPEN, assigneeRole: { not: "HR" } },
    _count: { _all: true },
  });
  if (rows.length === 0) return [] as RoutingWarning[];
  const ctx = await routingContextFor(prisma, employeeId, null);
  return routingWarnings(
    rows.map((r) => r.assigneeRole),
    ctx,
  );
}

const plural = (n: number) => (n === 1 ? "1 task" : `${n} tasks`);

/**
 * After a case's tasks are generated (and committed): tell each desk member
 * and the line manager what landed on them — one notice per person per case.
 * Fallback tasks held by the HR owner are not announced (the owner already
 * hears about the case). Never throws: the activation has committed.
 */
export async function notifyRoutedTasks(caseId: string): Promise<number> {
  try {
    const kase = await prisma.jmlCase.findUnique({
      where: { id: caseId },
      select: {
        caseRef: true,
        hrOwnerUserId: true,
        employee: { select: { name: true } },
        tasks: {
          where: { ...OPEN, assigneeRole: { not: "HR" } },
          select: { assigneeRole: true, ownerUserId: true },
          take: 500,
        },
      },
    });
    if (!kase || kase.tasks.length === 0) return 0;
    const members = await deskMembers();
    const counts = new Map<string, number>();
    const add = (userId: string | null) => {
      if (userId && userId !== kase.hrOwnerUserId)
        counts.set(userId, (counts.get(userId) ?? 0) + 1);
    };
    for (const t of kase.tasks) {
      const desk = deskOf(t.assigneeRole);
      if (desk && t.ownerUserId === null) members[desk].forEach(add);
      else add(t.ownerUserId);
    }
    let written = 0;
    for (const [userId, n] of counts) {
      written += await notifyUsers([userId], {
        kind: "JML_TASK_ASSIGNED",
        module: "jml",
        body: `${plural(n)} on ${kase.caseRef} for ${kase.employee.name} ${n === 1 ? "is" : "are"} assigned to you.`,
        href: "/jml/my-tasks",
        key: `jml-task-assigned:${caseId}`,
      });
    }
    return written;
  } catch {
    console.warn("[jml] routed-task notices could not be written");
    return 0;
  }
}

/**
 * D6 — re-assign open LINE_MANAGER tasks whose owner no longer matches the
 * employee's current line manager (the HR owner when there is none), and tell
 * the new owner. Called after an employee edit and by the hourly sweep (the
 * backstop for every other writer of `managerId`). Bounded; never throws.
 */
export async function reconcileLineManagerTasks(employeeIds?: readonly string[]) {
  try {
    const tasks = await prisma.jmlTask.findMany({
      where: {
        assigneeRole: "LINE_MANAGER" satisfies JmlAssigneeRole,
        ...OPEN,
        case: {
          status: { in: [...LIVE_CASE_STATUSES] },
          ...(employeeIds ? { employeeId: { in: [...employeeIds] } } : {}),
        },
      },
      select: {
        id: true,
        ownerUserId: true,
        caseId: true,
        case: {
          select: {
            caseRef: true,
            hrOwnerUserId: true,
            employee: {
              select: { name: true, manager: { select: MANAGER_SELECT } },
            },
          },
        },
      },
      take: 500,
    });
    const moved = new Map<string, { userId: string; caseRef: string; name: string; n: number }>();
    for (const t of tasks) {
      const want = managerLogin(t.case.employee.manager) ?? t.case.hrOwnerUserId;
      if (want === t.ownerUserId) continue;
      await prisma.jmlTask.update({
        where: { id: t.id },
        data: { ownerUserId: want, version: { increment: 1 } },
        select: { id: true },
      });
      if (want && want !== t.case.hrOwnerUserId) {
        const key = `${t.caseId}:${want}`;
        const prev = moved.get(key);
        moved.set(key, {
          userId: want,
          caseRef: t.case.caseRef,
          name: t.case.employee.name,
          n: (prev?.n ?? 0) + 1,
        });
      }
    }
    for (const [key, v] of moved) {
      await notifyUsers([v.userId], {
        kind: "JML_TASK_ASSIGNED",
        module: "jml",
        body: `${plural(v.n)} on ${v.caseRef} for ${v.name} moved to you as their line manager.`,
        href: "/jml/my-tasks",
        key: `jml-task-reassigned:${key.split(":")[0]}:${new Date().toISOString().slice(0, 10)}`,
      });
    }
    return { checked: tasks.length, moved: moved.size };
  } catch {
    console.warn("[jml] line-manager tasks could not be reconciled");
    return { checked: 0, moved: 0 };
  }
}
