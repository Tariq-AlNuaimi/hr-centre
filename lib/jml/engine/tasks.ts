import type { JmlComplianceCategory, JmlStage, Prisma } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { utcDate } from "@/lib/working-time/calendar";
import { JmlError } from "../errors";
import { loadCaseFor, type JmlActor } from "../access";
import { STAGE_ORDER, isLive } from "../vocab";
import { userHolds } from "./assignment";
import { computeProgress, deriveJoinStage } from "./progress";
import { advancedLeaveStage } from "./gates";

/**
 * The task engine's writes — every case type. The only Prisma writer of
 * `JmlTask` / `JmlTaskComment` outside generation.
 *
 * Fixes carried from the port inventories:
 *  - task writes are refused unless the case is live (Onboarding 8.4.7);
 *  - a task owner must be an HR user who holds `jml.workTasks` for the case
 *    (8.4.7);
 *  - completion runs the confirmation-trio and dependency gates for every type
 *    (Offboarding AC-4.2/4.4) — so a confirmation-required task CAN be completed
 *    from the screen, which collects the trio (F6);
 *  - LEAVE stage now advances when its blocking tasks settle (F4).
 */

export const TASK_SELECT = {
  id: true,
  caseId: true,
  code: true,
  name: true,
  stage: true,
  sortOrder: true,
  source: true,
  status: true,
  dateBasis: true,
  offsetDays: true,
  offsetUnit: true,
  dueDate: true,
  dueDateOverrideReason: true,
  mandatory: true,
  blocking: true,
  confirmationRequired: true,
  confirmingParty: true,
  confirmationDate: true,
  externalReference: true,
  reversalFlag: true,
  isReversal: true,
  dependsOnCodes: true,
  notApplicableReason: true,
  delayReason: true,
  statutory: true,
  complianceCategory: true,
  complianceDeadline: true,
  conditionSource: true,
  completedAt: true,
  version: true,
  owner: { select: { id: true, name: true, email: true } },
  completedBy: { select: { id: true, name: true } },
  _count: { select: { comments: true } },
} as const;

export type TaskRow = Prisma.JmlTaskGetPayload<{ select: typeof TASK_SELECT }>;

type Tx = Parameters<Parameters<typeof auditedTransaction>[0]>[0];

export const GATE_SELECT = {
  id: true,
  code: true,
  name: true,
  stage: true,
  status: true,
  mandatory: true,
  blocking: true,
  confirmationRequired: true,
  confirmingParty: true,
  confirmationDate: true,
  externalReference: true,
  dependsOnCodes: true,
} as const;

export type RefreshResult = {
  completionPct: number;
  stage: JmlStage;
  /** True when this refresh moved a JOIN/MOVE case to COMPLETED. */
  completedNow: boolean;
};

/**
 * Recompute the case summary from its tasks, in the caller's transaction, so a
 * task write and the case's percentage/stage commit together.
 */
export async function refreshCase(tx: Tx, caseId: string, actorUserId: string | null) {
  const kase = await tx.jmlCase.findUnique({
    where: { id: caseId },
    select: { caseType: true, status: true, stage: true },
  });
  if (!kase) throw new JmlError("Case not found", 404);
  const tasks = await tx.jmlTask.findMany({
    where: { caseId },
    select: GATE_SELECT,
    orderBy: [{ stage: "asc" }, { sortOrder: "asc" }],
    take: 1000,
  });
  const { completionPct } = computeProgress(tasks, kase.caseType);
  let stage: JmlStage = kase.stage;
  let completedNow = false;
  const data: Prisma.JmlCaseUpdateInput = { completionPct };
  if (kase.caseType === "LEAVE") {
    if (isLive(kase.status)) stage = advancedLeaveStage(kase.stage, tasks);
  } else if (kase.status === "ACTIVE" || kase.status === "COMPLETED") {
    stage = deriveJoinStage(tasks, kase.caseType);
    if (stage === "COMPLETED" && kase.status === "ACTIVE") {
      // Only on the transition, never cleared by a later recompute (Onboarding).
      data.status = "COMPLETED";
      data.completedAt = new Date();
      completedNow = true;
    }
  }
  data.stage = stage;
  if (actorUserId) data.lastUpdatedBy = { connect: { id: actorUserId } };
  await tx.jmlCase.update({ where: { id: caseId }, data, select: { id: true } });
  return { completionPct, stage, completedNow } satisfies RefreshResult;
}

export async function loadTaskForWork(actor: JmlActor, taskId: string) {
  const task = await prisma.jmlTask.findUnique({
    where: { id: taskId },
    select: { ...GATE_SELECT, caseId: true, version: true, isReversal: true },
  });
  if (!task) throw new JmlError("Task not found", 404);
  const kase = await loadCaseFor(actor, task.caseId, "jml.workTasks");
  if (!isLive(kase.status)) {
    throw new JmlError(
      `This case is ${kase.status.toLowerCase().replace("_", " ")}, so its checklist can no longer change.`,
    );
  }
  return { task, kase };
}

export async function assertOwner(userId: string, subject: Parameters<typeof userHolds>[2]) {
  if (!(await userHolds(userId, "jml.workTasks", subject))) {
    throw new JmlError(
      "A task owner must be an HR user who may work this case (Work checklist tasks permission)",
      422,
    );
  }
}

export type ManualTaskInput = {
  name: string;
  stage: JmlStage;
  dueDate: Date;
  mandatory: boolean;
  blocking: boolean;
  comment: string | null;
  ownerUserId: string | null;
  statutory: boolean;
  complianceCategory: JmlComplianceCategory | null;
  externalReference: string | null;
};

/**
 * Onboarding §10.5 / Offboarding manual task: any HR user with access adds a
 * task to one live case. Code `M-NN`; due date explicit; JOIN/MOVE require the
 * explanatory comment (written with the task).
 */
export async function addManualTask(actor: JmlActor, caseId: string, input: ManualTaskInput) {
  const kase = await loadCaseFor(actor, caseId, "jml.workTasks");
  if (!isLive(kase.status)) {
    throw new JmlError(
      "Tasks can only be added to a live case (not a draft, closed or cancelled one).",
    );
  }
  if (!STAGE_ORDER[kase.caseType].includes(input.stage)) {
    throw new JmlError("stage: that stage does not belong to this case type", 422);
  }
  if (kase.caseType !== "LEAVE" && !input.comment?.trim()) {
    throw new JmlError("comment: say why this task is needed (§10.5)", 422);
  }
  if (input.statutory && !input.complianceCategory) {
    throw new JmlError("complianceCategory: a statutory task needs a category", 422);
  }
  const ownerUserId = input.ownerUserId ?? kase.hrOwnerUserId;
  if (input.ownerUserId) await assertOwner(input.ownerUserId, kase.subject);
  return auditedTransaction(async (tx) => {
    const manual = await tx.jmlTask.findMany({
      where: { caseId, code: { startsWith: "M-" } },
      select: { code: true },
      take: 500,
    });
    const n = manual.reduce((m, t) => Math.max(m, Number(t.code.slice(2)) || 0), 0) + 1;
    const last = await tx.jmlTask.findFirst({
      where: { caseId, stage: input.stage },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const due = utcDate(input.dueDate);
    const task = await tx.jmlTask.create({
      data: {
        caseId,
        code: `M-${String(n).padStart(2, "0")}`,
        name: input.name,
        stage: input.stage,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        source: "MANUAL",
        dueDate: due,
        mandatory: input.mandatory,
        blocking: input.blocking,
        ownerUserId,
        statutory: input.statutory,
        complianceCategory: input.complianceCategory,
        complianceDeadline: input.statutory ? due : null,
        externalReference: input.externalReference,
        ...(input.comment?.trim()
          ? { comments: { create: { body: input.comment.trim(), authorId: actor.userId } } }
          : {}),
      },
      select: TASK_SELECT,
    });
    const summary = await refreshCase(tx, caseId, actor.userId);
    return { task, ...summary };
  });
}

/** Insert-only comments (Onboarding §10.3 / Offboarding §9.6). */
export async function addComment(actor: JmlActor, taskId: string, body: string) {
  const task = await prisma.jmlTask.findUnique({
    where: { id: taskId },
    select: { id: true, caseId: true },
  });
  if (!task) throw new JmlError("Task not found", 404);
  await loadCaseFor(actor, task.caseId, "jml.workTasks");
  return prisma.jmlTaskComment.create({
    data: { taskId, body, authorId: actor.userId },
    select: { id: true, body: true, createdAt: true, author: { select: { id: true, name: true } } },
  });
}

export async function listComments(actor: JmlActor, taskId: string) {
  const task = await prisma.jmlTask.findUnique({
    where: { id: taskId },
    select: { caseId: true },
  });
  if (!task) throw new JmlError("Task not found", 404);
  await loadCaseFor(actor, task.caseId, "jml.view");
  return prisma.jmlTaskComment.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { id: true, body: true, createdAt: true, author: { select: { id: true, name: true } } },
  });
}

export async function listTasks(actor: JmlActor, caseId: string) {
  await loadCaseFor(actor, caseId, "jml.view");
  return prisma.jmlTask.findMany({
    where: { caseId },
    orderBy: [{ stage: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
    take: 500,
    select: TASK_SELECT,
  });
}

/** Explicit audit for a bulk task write (ADR-010) — one row per task. */
export async function auditTaskBulk(
  tx: Tx,
  rows: Array<{ id: string; before: Record<string, unknown>; after: Record<string, unknown> }>,
) {
  for (const r of rows) {
    await recordAudit(tx, {
      entityType: "JmlTask",
      entityId: r.id,
      action: "UPDATE",
      before: r.before,
      after: r.after,
    });
  }
}
