import type { JmlAssigneeRole, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/pms/actor";
import { LIVE_CASE_STATUSES, SETTLED_TASK_STATUSES } from "../vocab";
import { desksOf } from "./desks";
import { workerMayWork, type WorkerFacts } from "./rules";

/**
 * The derived task worker (docs/blueprints/jml-task-routing.md D2, D4): a desk
 * member or the employee's line manager working a routed task WITHOUT holding
 * `jml.workTasks`. Kept free of `lib/jml/access.ts` so that file can ask
 * `isRoutedParticipant` without an import cycle.
 */

type Actor = Pick<ResolvedActor, "userId" | "employeeId">;

export async function workerFacts(actor: Actor): Promise<WorkerFacts> {
  return { desks: await desksOf(actor.userId), employeeId: actor.employeeId };
}

/**
 * Prisma filter for the tasks a worker may work by derived authority — their
 * desks' tasks, and the LINE_MANAGER tasks of their direct reports. `null`
 * when they have no such authority at all.
 */
export function workerTaskWhere(facts: WorkerFacts): Prisma.JmlTaskWhereInput | null {
  const or: Prisma.JmlTaskWhereInput[] = [];
  if (facts.desks.size > 0) or.push({ assigneeRole: { in: [...facts.desks] } });
  if (facts.employeeId) {
    or.push({
      assigneeRole: "LINE_MANAGER",
      case: { employee: { managerId: facts.employeeId } },
    });
  }
  return or.length > 0 ? { OR: or } : null;
}

/** May this actor work this task as a derived worker? */
export async function mayWorkAsWorker(
  actor: Actor,
  task: { caseId: string; assigneeRole: JmlAssigneeRole },
): Promise<boolean> {
  if (task.assigneeRole === "HR") return false;
  const kase = await prisma.jmlCase.findUnique({
    where: { id: task.caseId },
    select: { employee: { select: { managerId: true } } },
  });
  if (!kase) return false;
  return workerMayWork(await workerFacts(actor), task, kase.employee);
}

/**
 * Does the actor have a routed task on this case? Such a person knows the case
 * exists, so the rest of it answers 403 to them rather than 404 (worst path:
 * a desk user opening a leaver's settlement).
 */
export async function isRoutedParticipant(actor: Actor, caseId: string): Promise<boolean> {
  const where = workerTaskWhere(await workerFacts(actor));
  if (!where) return false;
  const n = await prisma.jmlTask.count({ where: { AND: [{ caseId }, where] } });
  return n > 0;
}

/** Does the actor have any open routed work anywhere (nav + My tasks gate)? */
export async function hasWorkerTasks(actor: Actor): Promise<boolean> {
  const where = workerTaskWhere(await workerFacts(actor));
  if (!where) return false;
  const found = await prisma.jmlTask.findFirst({
    where: {
      AND: [
        where,
        { status: { notIn: [...SETTLED_TASK_STATUSES] } },
        { case: { status: { in: [...LIVE_CASE_STATUSES] } } },
      ],
    },
    select: { id: true },
  });
  return found !== null;
}

/**
 * The tasks on a person's own list: those they OWN, plus those routed to them
 * by derived authority (their desks', their direct reports' LINE_MANAGER
 * tasks). One OR — the lists stay one bounded query.
 */
export async function myTaskWhere(actor: Actor): Promise<Prisma.JmlTaskWhereInput> {
  const routed = workerTaskWhere(await workerFacts(actor));
  return routed ? { OR: [{ ownerUserId: actor.userId }, routed] } : { ownerUserId: actor.userId };
}
