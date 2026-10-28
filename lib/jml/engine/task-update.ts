import type { JmlTaskStatus, Prisma } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { utcDate } from "@/lib/working-time/calendar";
import { JmlError } from "../errors";
import type { JmlActor } from "../access";
import { TASK_STATUSES } from "../vocab";
import { canCompleteTask, type GateTask } from "./gates";
import { notApplicableData, reopenData } from "./task-status-rules";
import { reconcileLineManagerTasks } from "../routing/assign";
import { workerChangeProblem } from "../routing/rules";
import { GATE_SELECT, TASK_SELECT, assertOwner, loadTaskForWork, refreshCase } from "./tasks";

/**
 * The one door for changing a task (lib/jml/engine/tasks.ts holds the rest of
 * the task engine): status / complete / N/A / reopen / delay / due date /
 * owner / reference / confirmation trio, with the per-type rules.
 */

export type UpdateTaskInput = {
  status?: JmlTaskStatus;
  delayReason?: string | null;
  notApplicableReason?: string | null;
  dueDate?: Date | null;
  dueDateOverrideReason?: string | null;
  ownerUserId?: string | null;
  externalReference?: string | null;
  confirmingParty?: string | null;
  confirmationDate?: Date | null;
  /** Re-open reason (Offboarding stores it in `delayReason`). */
  reason?: string | null;
  expectedVersion?: number;
};

type LoadedTask = Awaited<ReturnType<typeof loadTaskForWork>>["task"];
type LoadedCase = Awaited<ReturnType<typeof loadTaskForWork>>["kase"];

async function completionData(
  actor: JmlActor,
  task: LoadedTask,
  input: UpdateTaskInput,
): Promise<Prisma.JmlTaskUpdateInput> {
  const all = await prisma.jmlTask.findMany({
    where: { caseId: task.caseId },
    select: GATE_SELECT,
    take: 1000,
  });
  const merged: GateTask = {
    ...task,
    confirmingParty: input.confirmingParty ?? task.confirmingParty,
    confirmationDate: input.confirmationDate ?? task.confirmationDate,
    externalReference: input.externalReference ?? task.externalReference,
  };
  const gate = canCompleteTask(merged, all);
  if (!gate.allowed) throw new JmlError(gate.reason, 409);
  return { completedAt: new Date(), completedBy: { connect: { id: actor.userId } } };
}

async function statusData(
  actor: JmlActor,
  task: LoadedTask,
  kase: LoadedCase,
  input: UpdateTaskInput,
): Promise<Prisma.JmlTaskUpdateInput> {
  const next = input.status;
  if (!next || next === task.status) return {};
  if (!TASK_STATUSES[kase.caseType].includes(next)) {
    throw new JmlError(`${next} is not a task status for this case type`, 422);
  }
  if (next === "COMPLETED") return { status: next, ...(await completionData(actor, task, input)) };
  let data: Prisma.JmlTaskUpdateInput = { status: next };
  if (task.status === "COMPLETED") data = { ...data, ...reopenData(actor, kase, next, input) };
  if (next === "NOT_APPLICABLE") data = { ...data, ...notApplicableData(kase, task, input) };
  if (next === "DELAYED") {
    if (!input.delayReason || input.delayReason.trim().length < 3) {
      throw new JmlError("delayReason: say why it is delayed (3 characters or more)", 422);
    }
    data.delayReason = input.delayReason.trim();
  } else if (task.status === "DELAYED" && data.delayReason === undefined) {
    // A task that leaves DELAYED stops explaining a delay it is no longer in.
    data.delayReason = null;
  }
  return data;
}

async function fieldData(
  kase: LoadedCase,
  task: LoadedTask,
  input: UpdateTaskInput,
): Promise<Prisma.JmlTaskUpdateInput> {
  const data: Prisma.JmlTaskUpdateInput = {};
  if (input.dueDate !== undefined) {
    if (kase.caseType === "LEAVE" && !input.dueDateOverrideReason?.trim()) {
      throw new JmlError("dueDateOverrideReason: a changed due date needs a reason", 422);
    }
    data.dueDate = input.dueDate ? utcDate(input.dueDate) : null;
    data.dueDateOverrideReason = input.dueDateOverrideReason?.trim() || null;
  }
  if (input.ownerUserId !== undefined) {
    if (input.ownerUserId) {
      await assertOwner(input.ownerUserId, kase.subject, {
        assigneeRole: task.assigneeRole,
        caseId: task.caseId,
      });
    }
    data.owner = input.ownerUserId ? { connect: { id: input.ownerUserId } } : { disconnect: true };
  }
  if (input.externalReference !== undefined) data.externalReference = input.externalReference;
  if (input.confirmingParty !== undefined) data.confirmingParty = input.confirmingParty;
  if (input.confirmationDate !== undefined) data.confirmationDate = input.confirmationDate;
  return data;
}

/**
 * Status, delay, due date, owner, reference — Onboarding `updateTask` +
 * Offboarding complete / N/A / reopen, as one door with the per-type rules:
 *  - COMPLETED goes through `canCompleteTask` (every type);
 *  - leaving COMPLETED on a LEAVE task is a REOPEN (see `reopenData`);
 *  - NOT_APPLICABLE on LEAVE needs a reason and is refused on reversal tasks;
 *  - DELAYED needs a reason (≥ 3 characters);
 *  - a LEAVE due-date override needs a reason (§9.6).
 */
export async function updateTask(actor: JmlActor, taskId: string, input: UpdateTaskInput) {
  const { task, kase, limited } = await loadTaskForWork(actor, taskId);
  if (limited) {
    // A desk member or line manager working a routed task: the work, not its planning.
    const problem = workerChangeProblem(input, task.status);
    if (problem) throw new JmlError(problem, 403);
  }
  if (input.expectedVersion !== undefined && input.expectedVersion !== task.version) {
    throw new JmlError("This task was changed by someone else a moment ago — reload it.", 409);
  }
  const data: Prisma.JmlTaskUpdateInput = {
    ...(await fieldData(kase, task, input)),
    ...(await statusData(actor, task, kase, input)),
  };
  if (Object.keys(data).length === 0) return getTaskWithSummary(task.id);
  data.version = { increment: 1 };

  const result = await auditedTransaction(async (tx) => {
    // Conditional on the version we read (Offboarding AC-6.2: a racing write loses).
    const updated = await tx.jmlTask
      .update({ where: { id: task.id, version: task.version }, data, select: TASK_SELECT })
      .catch((e: unknown) => {
        if ((e as { code?: string }).code === "P2025") {
          throw new JmlError("This task was changed by someone else a moment ago — reload it.");
        }
        throw e;
      });
    const summary = await refreshCase(tx, task.caseId, actor.userId);
    return { task: updated, ...summary };
  });
  // A mover's change may have just reached the employee record (D9) — a new
  // line manager takes over the open LINE_MANAGER tasks (task routing D6).
  if (result.completedNow && kase.caseType === "MOVE") {
    await reconcileLineManagerTasks([kase.employeeId]);
  }
  return result;
}

async function getTaskWithSummary(taskId: string) {
  const task = await prisma.jmlTask.findUniqueOrThrow({
    where: { id: taskId },
    select: TASK_SELECT,
  });
  const kase = await prisma.jmlCase.findUniqueOrThrow({
    where: { id: task.caseId },
    select: { completionPct: true, stage: true },
  });
  return { task, ...kase, completedNow: false };
}
