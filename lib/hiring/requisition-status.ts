import type { HiringRequisition, HiringRequisitionStatus } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import type { ScopeSubject } from "@/lib/rbac/grants";
import { isHiringAdmin, type HiringActor } from "./access";
import { assertChainStaffed, getRoutedChain, type RoutedStep } from "./approval-config";
import { describeFill, fillLabel, nextFillStatus } from "./fill-rules";
import { HiringRuleError } from "./http";
import { notifyApprovalStep } from "./notify";
import { resolveUserNotices } from "@/lib/core/notify/user-notify";
import { toNum, toOMRorNull } from "./money";
import { seatOccupancyWhere } from "./requisitions";
import {
  isAllowedTransition,
  isFinalStep,
  nextUnsignedStep,
  readinessProblems,
  signRefusal,
} from "./requisition-rules";

/**
 * Status changes + the two-step requisition approval (Interview Hub
 * `PATCH /api/positions/[id]/status`, ADR-024/063). Every change carries a
 * mandatory reason and writes its history row in the same transaction, with a
 * compare-and-swap on the status read.
 */

async function entityCode(entityId: string): Promise<string> {
  const e = await prisma.orgEntity.findUnique({ where: { id: entityId }, select: { code: true } });
  return e?.code ?? "";
}

export async function requisitionChain(req: HiringRequisition, subject: ScopeSubject) {
  return getRoutedChain(
    await entityCode(req.entityId),
    subject,
    toOMRorNull(req.salaryBandMax, req.salaryCurrency),
    "requisition",
  );
}

/** The current approval round (last move INTO PENDING_APPROVAL) and its sign-offs. */
export async function currentRound(requisitionId: string) {
  const submission = await prisma.hiringRequisitionStatusHistory.findFirst({
    where: { requisitionId, toStatus: "PENDING_APPROVAL" },
    orderBy: { changedAt: "desc" },
    select: { id: true, changedById: true, changedAt: true },
  });
  const signed = submission
    ? await prisma.hiringRequisitionApproval.findMany({
        where: { submissionId: submission.id },
        orderBy: { sequence: "asc" },
        take: 20,
        select: {
          sequence: true,
          requiredRole: true,
          approverId: true,
          comment: true,
          createdAt: true,
        },
      })
    : [];
  return { submission, signed };
}

export type StatusResult = {
  status: HiringRequisitionStatus;
  approvalStep?: { signed: string; next: string | null };
};

export async function changeRequisitionStatus(
  actor: HiringActor,
  req: HiringRequisition,
  subject: ScopeSubject,
  to: HiringRequisitionStatus,
  reason: string,
): Promise<StatusResult> {
  const from = req.status;
  if (!isAllowedTransition(from, to)) {
    throw new HiringRuleError(`A requisition cannot move from ${from} to ${to}.`, 400);
  }
  if (to === "PENDING_APPROVAL") {
    const problems = readinessProblems({
      ...req,
      salaryBandMin: toNum(req.salaryBandMin),
      salaryBandMax: toNum(req.salaryBandMax),
    });
    if (problems.length) {
      throw new HiringRuleError(
        `Complete these fields before submitting for approval: ${problems.join(", ")}.`,
        422,
        "NOT_READY",
      );
    }
    assertChainStaffed((await requisitionChain(req, subject)).steps);
  }
  let finalSignoff: {
    submissionId: string;
    sequence: number;
    requiredRole: RoutedStep["role"];
  } | null = null;
  if (from === "PENDING_APPROVAL" && to === "OPEN") {
    const step = await signStep(actor, req, subject, reason);
    if (step.recordedOnly) {
      await notifyNextRequisitionStep(req, subject);
      return { status: from, approvalStep: step.recordedOnly };
    }
    finalSignoff = step.final;
  }
  await auditedTransaction(async (tx) => {
    await tx.hiringRequisition.update({
      where: { id: req.id, status: from },
      data: { status: to },
    });
    await tx.hiringRequisitionStatusHistory.create({
      data: {
        requisitionId: req.id,
        fromStatus: from,
        toStatus: to,
        changedById: actor.userId,
        reason,
      },
    });
    if (finalSignoff) {
      await tx.hiringRequisitionApproval.create({
        data: { requisitionId: req.id, approverId: actor.userId, comment: reason, ...finalSignoff },
      });
    }
  });
  // QA D-14: whatever was decided, the notices for the step(s) just acted on
  // are done; the next step (if any) is notified afresh below.
  await resolveUserNotices(`hiring:requisition:${req.id}:`);
  if (to === "PENDING_APPROVAL") await notifyNextRequisitionStep(req, subject);
  return { status: to };
}

/**
 * Bell notice to the holders of the round's next unsigned step (UX review P0,
 * US-6) — on submission and after each intermediate sign-off. Never the
 * submitter or an earlier signer (they may not sign it). Never throws.
 */
export async function notifyNextRequisitionStep(
  req: Pick<HiringRequisition, "id" | "title" | "entityId" | "salaryBandMax" | "salaryCurrency">,
  subject: ScopeSubject,
): Promise<void> {
  try {
    const [{ submission, signed }, { steps }] = await Promise.all([
      currentRound(req.id),
      requisitionChain(req as HiringRequisition, subject),
    ]);
    if (!submission) return;
    await notifyApprovalStep({
      what: "requisition",
      id: req.id,
      title: req.title,
      step: nextUnsignedStep(steps, signed),
      round: submission.id,
      exclude: [submission.changedById, ...signed.map((x) => x.approverId)],
    });
  } catch {
    console.warn("[hiring] a requisition approval notice could not be prepared");
  }
}

/** Decide the next unsigned step; record an intermediate one, or hand back the final. */
async function signStep(
  actor: HiringActor,
  req: HiringRequisition,
  subject: ScopeSubject,
  reason: string,
) {
  const [{ submission, signed }, { steps }] = await Promise.all([
    currentRound(req.id),
    requisitionChain(req, subject),
  ]);
  const step = nextUnsignedStep(steps, signed);
  if (!step)
    throw new HiringRuleError("No approval step is left to sign on this requisition.", 409);
  if (signed.some((s) => s.sequence === step.sequence)) {
    throw new HiringRuleError(
      "The approval chain changed while this requisition was pending — send it back and re-submit it to start a fresh round.",
      409,
    );
  }
  const refusal = signRefusal({
    actorId: actor.userId,
    isAdmin: isHiringAdmin(actor),
    requesterId: submission?.changedById ?? null,
    routedApproverIds: step.approvers.map((a) => a.id),
    priorSignerIds: signed.map((s) => s.approverId),
  });
  if (refusal) throw new HiringRuleError(refusal, 403);
  const signoff = {
    submissionId: submission!.id,
    sequence: step.sequence,
    requiredRole: step.role,
  };
  if (isFinalStep(steps, step)) return { final: signoff, recordedOnly: null };
  const recorded = await auditedTransaction(async (tx) => {
    const latest = await tx.hiringRequisitionStatusHistory.findFirst({
      where: { requisitionId: req.id, toStatus: "PENDING_APPROVAL" },
      orderBy: { changedAt: "desc" },
      select: { id: true, requisition: { select: { status: true } } },
    });
    if (latest?.id !== signoff.submissionId || latest.requisition.status !== "PENDING_APPROVAL")
      return false;
    await tx.hiringRequisitionApproval.create({
      data: { requisitionId: req.id, approverId: actor.userId, comment: reason, ...signoff },
    });
    return true;
  });
  if (!recorded)
    throw new HiringRuleError(
      "This requisition changed since you loaded it — reload and retry.",
      409,
    );
  const next = nextUnsignedStep(steps, [...signed, signoff]);
  return { final: null, recordedOnly: { signed: step.role, next: next?.role ?? null } };
}

/**
 * Seat-fill sync: after anything that takes or releases a seat. Writes only on
 * a change, CAS on the status read (a hand-set ON_HOLD always wins).
 */
export async function syncRequisitionFill(
  requisitionId: string | null | undefined,
  opts: { actorId?: string | null; seatReleased?: boolean } = {},
): Promise<void> {
  if (!requisitionId) return;
  const req = await prisma.hiringRequisition.findUnique({
    where: { id: requisitionId },
    select: { status: true, openings: true },
  });
  if (!req) return;
  const filled = await prisma.hiringCandidate.count({ where: seatOccupancyWhere(requisitionId) });
  const next = nextFillStatus({
    status: req.status,
    openings: req.openings,
    filled,
    seatReleased: opts.seatReleased,
  });
  if (!next) return;
  const label = fillLabel(describeFill(req.openings, filled)).toLowerCase();
  try {
    await auditedTransaction(async (tx) => {
      await tx.hiringRequisition.update({
        where: { id: requisitionId, status: req.status },
        data: { status: next },
      });
      await tx.hiringRequisitionStatusHistory.create({
        data: {
          requisitionId,
          fromStatus: req.status,
          toStatus: next,
          changedById: opts.actorId ?? null,
          reason:
            next === "FILLED" ? `All openings filled — ${label}.` : `A seat came back — ${label}.`,
        },
      });
    });
  } catch (e) {
    if ((e as { code?: string })?.code !== "P2025") throw e;
  }
}

/** An approver without edit rights may still reject / send back the step routed to them. */
export async function assertRoutedToActor(
  actor: HiringActor,
  req: HiringRequisition,
  subject: ScopeSubject,
) {
  const [{ signed }, { steps }] = await Promise.all([
    currentRound(req.id),
    requisitionChain(req, subject),
  ]);
  const step = nextUnsignedStep(steps, signed);
  if (!isHiringAdmin(actor) && !step?.approvers.some((a) => a.id === actor.userId)) {
    throw new HiringRuleError("Only the approver routed to this step can decide it.", 403);
  }
}
