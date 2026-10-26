import { auditedTransaction, prisma } from "@/lib/prisma";
import { loadCaseFor, MANAGE_PERMISSION, type AccessibleCase, type JmlActor } from "../access";
import { cancelQueuedEmails } from "../email/queue";
import { JmlError } from "../errors";
import { SETTLED_TASK_STATUSES, isLive } from "../vocab";
import { userHolds } from "./assignment";

/**
 * Case-level actions shared by every type — HR Onboarding `case.ts` (cancel,
 * archive, reassign) and `retention.ts` (legal hold). Seniority checks
 * (`actorSeniority`) are now permissions held for the case's employee:
 * cancelling is the type's manage permission; archive, reassign and legal hold
 * are `jml.supervise` (Senior HR / HR Manager).
 *
 * Fixes: archive never deletes (Offboarding F1) and is reachable for cancelled
 * cases (Onboarding 8.4.6); reassigning moves the open tasks with the case
 * (8.4.7); a task owner must be able to work the case.
 */

type Tx = Parameters<Parameters<typeof auditedTransaction>[0]>[0];

const OPEN_TASK = { status: { notIn: [...SETTLED_TASK_STATUSES] } };

async function bumpCase(
  tx: Tx,
  kase: AccessibleCase,
  data: Record<string, unknown>,
  actor: JmlActor,
) {
  await tx.jmlCase.update({
    where: { id: kase.id, version: kase.version },
    data: { ...data, lastUpdatedById: actor.userId, version: { increment: 1 } },
    select: { id: true },
  });
}

/** Cancel the open tasks and queued messages of a case, per row (audited). */
export async function cancelOpenWork(tx: Tx, caseId: string, reason: string): Promise<number> {
  const open = await tx.jmlTask.findMany({
    where: { caseId, ...OPEN_TASK },
    select: { id: true },
    take: 1000,
  });
  for (const t of open) {
    await tx.jmlTask.update({
      where: { id: t.id },
      data: { status: "CANCELLED", version: { increment: 1 } },
      select: { id: true },
    });
  }
  await cancelQueuedEmails(tx, caseId, reason);
  return open.length;
}

/**
 * Cancel a JOIN or MOVE case (§17.5, BR-017). The EMP code is kept and never
 * reused; the person record is untouched (a MOVE applies nothing until it
 * completes, D9). LEAVE cancellation lives with the leaver workflow.
 */
export async function cancelCase(actor: JmlActor, caseId: string, reason: string) {
  const head = await prisma.jmlCase.findUnique({
    where: { id: caseId },
    select: { caseType: true },
  });
  if (!head) throw new JmlError("Case not found", 404);
  const kase = await loadCaseFor(actor, caseId, MANAGE_PERMISSION[head.caseType]);
  if (kase.caseType === "LEAVE") {
    throw new JmlError("Withdraw a leaver case from its exit screen.", 409);
  }
  if (kase.status === "DRAFT") {
    throw new JmlError("A draft is discarded, not cancelled.", 409);
  }
  if (!isLive(kase.status)) {
    throw new JmlError(`This case is already ${kase.status.toLowerCase()}.`, 409);
  }
  await auditedTransaction(async (tx) => {
    await cancelOpenWork(tx, caseId, `${kase.caseRef} cancelled`);
    await bumpCase(
      tx,
      kase,
      { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
      actor,
    );
  });
  return { cancelled: true };
}

/** Archive (Senior): a finished or cancelled case leaves the working lists; nothing is deleted. */
export async function archiveCase(actor: JmlActor, caseId: string) {
  const kase = await loadCaseFor(actor, caseId, "jml.supervise");
  if (kase.status === "ARCHIVED") throw new JmlError("This case is already archived.", 409);
  if (kase.status === "DRAFT" || isLive(kase.status)) {
    throw new JmlError("Complete or cancel the case before archiving it.", 409);
  }
  // AC-2.4: a withdrawn exit stays in the working lists until its reversals are done.
  const openReversals = await prisma.jmlTask.count({
    where: { caseId, isReversal: true, ...OPEN_TASK },
  });
  if (openReversals > 0) {
    throw new JmlError(
      `${openReversals} reversal task${openReversals === 1 ? " is" : "s are"} still open. Complete or mark them not applicable before archiving.`,
      409,
    );
  }
  await auditedTransaction((tx) =>
    bumpCase(
      tx,
      kase,
      { status: "ARCHIVED", archivedAt: new Date(), archivedById: actor.userId },
      actor,
    ),
  );
  return { archived: true };
}

/** Reassign the case owner (Senior); open tasks of the old owner follow by default. */
export async function reassignOwner(
  actor: JmlActor,
  caseId: string,
  input: { hrOwnerUserId: string; moveOpenTasks: boolean },
) {
  const kase = await loadCaseFor(actor, caseId, "jml.supervise");
  if (kase.status === "CANCELLED" || kase.status === "ARCHIVED" || kase.status === "CLOSED") {
    throw new JmlError("A closed case cannot change owner.", 409);
  }
  if (!(await userHolds(input.hrOwnerUserId, "jml.workTasks", kase.subject))) {
    throw new JmlError(
      "The new owner must be an HR user who may work this case (Work checklist tasks permission).",
      422,
    );
  }
  const previous = kase.hrOwnerUserId;
  let moved = 0;
  await auditedTransaction(async (tx) => {
    await bumpCase(tx, kase, { hrOwnerUserId: input.hrOwnerUserId }, actor);
    if (!input.moveOpenTasks || !previous) return;
    const tasks = await tx.jmlTask.findMany({
      where: { caseId, ownerUserId: previous, ...OPEN_TASK },
      select: { id: true },
      take: 1000,
    });
    for (const t of tasks) {
      await tx.jmlTask.update({
        where: { id: t.id },
        data: { ownerUserId: input.hrOwnerUserId, version: { increment: 1 } },
        select: { id: true },
      });
    }
    moved = tasks.length;
  });
  return { hrOwnerUserId: input.hrOwnerUserId, tasksMoved: moved };
}

/** Place or lift a legal hold (§17.3): a held case is skipped by retention. */
export async function setLegalHold(
  actor: JmlActor,
  caseId: string,
  input: { hold: boolean; reason: string | null },
) {
  const kase = await loadCaseFor(actor, caseId, "jml.supervise");
  const row = await prisma.jmlCase.findUnique({
    where: { id: caseId },
    select: { anonymisedAt: true },
  });
  if (row?.anonymisedAt) throw new JmlError("This case has been anonymised.", 409);
  await auditedTransaction((tx) =>
    bumpCase(
      tx,
      kase,
      input.hold
        ? {
            legalHold: true,
            legalHoldReason: input.reason,
            legalHoldAt: new Date(),
            legalHoldById: actor.userId,
          }
        : { legalHold: false, legalHoldReason: null, legalHoldAt: null, legalHoldById: null },
      actor,
    ),
  );
  return { legalHold: input.hold };
}
