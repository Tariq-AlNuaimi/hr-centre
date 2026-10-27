import type { JmlTaskStatus, Prisma } from "@/generated/prisma/client";
import { JmlError } from "../errors";
import { canFor, type JmlActor } from "../access";
import type { loadTaskForWork } from "./tasks";
import type { UpdateTaskInput } from "./task-update";

type Loaded = Awaited<ReturnType<typeof loadTaskForWork>>;

/** Leaving COMPLETED and marking Not Applicable — the per-type task status rules. */

/** Leaving COMPLETED: a REOPEN for LEAVE (Senior HR+, to In progress, reason), free for JOIN/MOVE. */
export function reopenData(
  actor: JmlActor,
  kase: Loaded["kase"],
  next: JmlTaskStatus,
  input: UpdateTaskInput,
): Prisma.JmlTaskUpdateInput {
  const data: Prisma.JmlTaskUpdateInput = { completedAt: null, completedBy: { disconnect: true } };
  if (kase.caseType !== "LEAVE") return data;
  if (!canFor(actor, "jml.reopenTasks", kase.subject)) {
    throw new JmlError("Only Senior HR or the HR Manager can reopen a completed task.", 403);
  }
  if (next !== "IN_PROGRESS")
    throw new JmlError("A completed exit task reopens to In progress.", 422);
  if (!input.reason?.trim()) throw new JmlError("reason: say why it is reopened", 422);
  return {
    ...data,
    delayReason: input.reason.trim(),
    confirmingParty: null,
    confirmationDate: null,
    externalReference: null,
  };
}

export function notApplicableData(
  kase: Loaded["kase"],
  task: Loaded["task"],
  input: UpdateTaskInput,
): Prisma.JmlTaskUpdateInput {
  if (kase.caseType === "LEAVE" && task.isReversal) {
    throw new JmlError("A reversal task cannot be marked Not Applicable — it must be done.", 409);
  }
  // QA D-09: a MANDATORY task set aside without a reason silently lowers the
  // bar the case completes against, for every case type (as DELAYED does).
  if ((kase.caseType === "LEAVE" || task.mandatory) && !input.notApplicableReason?.trim()) {
    throw new JmlError("notApplicableReason: say why it does not apply", 422);
  }
  return { notApplicableReason: input.notApplicableReason?.trim() || null };
}
