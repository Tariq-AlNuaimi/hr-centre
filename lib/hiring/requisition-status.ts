import type {
  HiringApprovalRole,
  HiringRequisition,
  HiringRequisitionStatus,
} from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import type { ScopeSubject } from "@/lib/rbac/grants";
import { currentStep, decisionRefusal } from "@/lib/core/approvals/rules";
import {
  ApprovalRefusal,
  cancelOpenRounds,
  decide,
  decisionStates,
  latestRound,
  openRound,
  type Round,
  type Tx,
} from "@/lib/core/approvals/store";
import { isHiringAdmin, type HiringActor } from "./access";
import {
  approvalRoleLabel,
  assertChainStaffed,
  getRoutedChain,
  routeChain,
  type RoutedStep,
} from "./approval-config";
import { describeFill, fillLabel, nextFillStatus } from "./fill-rules";
import { HiringRuleError } from "./http";
import { notifyApprovalStep } from "./notify";
import { resolveUserNotices } from "@/lib/core/notify/user-notify";
import { toNum, toOMRorNull } from "./money";
import { REQUISITION_SUBJECT, delegatorActors, qualifyForRole } from "./offer-round";
import { seatOccupancyWhere } from "./requisitions";
import {
  isAllowedTransition,
  parseDecisionNote,
  readinessProblems,
  requisitionRefusalMessage,
} from "./requisition-rules";

/**
 * Status changes + the two-step requisition approval (Interview Hub
 * `PATCH /api/positions/[id]/status`, ADR-024/063). Every change carries a
 * mandatory reason and writes its history row in the same transaction, with a
 * compare-and-swap on the status read.
 *
 * The approval rounds live in the core approvals engine (ADR-094): each move
 * INTO PENDING_APPROVAL opens a round whose steps are the chain at that moment
 * (HR Manager, then Operations Director); sign-offs are engine decisions; a
 * move out of PENDING_APPROVAL closes the round (approved, rejected, sent back
 * or cancelled). The status history keeps every move and its reason.
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

/** Open the approval round of a submission, in the submitting transaction. */
export async function openRequisitionRound(
  tx: Tx,
  req: Pick<HiringRequisition, "id" | "title">,
  submittedById: string,
  steps: readonly { role: HiringApprovalRole }[],
) {
  await openRound(tx, {
    module: "hiring",
    subjectType: REQUISITION_SUBJECT,
    subjectId: req.id,
    title: req.title,
    href: `/hiring/requisitions/${req.id}/approval`,
    submittedById,
    steps: steps.map((s) => ({ roleKey: s.role, label: approvalRoleLabel(s.role) })),
  });
}

/** The latest approval round (the last move INTO PENDING_APPROVAL) and its sign-offs. */
export async function currentRound(requisitionId: string) {
  const round = await latestRound(REQUISITION_SUBJECT, requisitionId);
  return roundView(round);
}

/** A round in the shape the approval screen reads (submission + signatures). */
function roundView(round: Round | null) {
  if (!round) return { round: null, submission: null, signed: [] };
  const roleOf = new Map(round.steps.map((s) => [s.sequence, s.roleKey]));
  return {
    round,
    submission: { id: round.id, changedById: round.submittedById, changedAt: round.createdAt },
    signed: round.decisions
      .filter((d) => d.action === "APPROVED")
      .map((d) => ({
        sequence: d.step.sequence,
        requiredRole: roleOf.get(d.step.sequence) ?? "",
        approverId: d.deciderId,
        comment: d.comment ?? "",
        createdAt: d.decidedAt,
      })),
  };
}

/**
 * Why the actor may not sign the round's current step (Hiring's sentence), or
 * null. Holders, their delegates (ADR-094) and hiring admins qualify.
 */
export function requisitionRefusal(
  actor: HiringActor,
  delegators: readonly HiringActor[],
  round: Round | null,
  subject: ScopeSubject,
  opts: { proxy?: boolean } = {},
): string | null {
  const step = round?.status === "PENDING" ? currentStep(round.steps) : undefined;
  if (!round || !step) return requisitionRefusalMessage("NO_SUBMITTER");
  const q = qualifyForRole(actor, delegators, step.roleKey as HiringApprovalRole, subject);
  const code = decisionRefusal({
    actorId: actor.userId,
    actingFor: q?.onBehalfOfId ?? null,
    submitterId: round.submittedById,
    excludedIds: round.excludedIds,
    step,
    decisions: decisionStates(round),
    qualified: q !== null && (opts.proxy !== false || !q.viaProxy),
  });
  return code ? requisitionRefusalMessage(code) : null;
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
  let chain: RoutedStep[] = [];
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
    chain = (await requisitionChain(req, subject)).steps;
    assertChainStaffed(chain);
  }
  if (from === "PENDING_APPROVAL" && to === "OPEN") return signStep(actor, req, subject, reason);
  if (from === "PENDING_APPROVAL" && to === "DRAFT") {
    const decided = await declineAsDecision(actor, req, subject, reason);
    if (decided) return decided;
  }
  await auditedTransaction(async (tx) => {
    await moveStatus(tx, req.id, from, to, actor.userId, reason);
    if (to === "PENDING_APPROVAL") await openRequisitionRound(tx, req, actor.userId, chain);
    else if (from === "PENDING_APPROVAL") await cancelOpenRounds(tx, REQUISITION_SUBJECT, req.id);
  });
  // QA D-14: whatever was decided, the notices for the step(s) just acted on
  // are done; the next step (if any) is notified afresh below.
  await resolveUserNotices(`hiring:requisition:${req.id}:`);
  if (to === "PENDING_APPROVAL") await notifyNextRequisitionStep(req, subject);
  return { status: to };
}

async function moveStatus(
  tx: Tx,
  id: string,
  from: HiringRequisitionStatus,
  to: HiringRequisitionStatus,
  changedById: string,
  reason: string,
) {
  await tx.hiringRequisition.update({ where: { id, status: from }, data: { status: to } });
  await tx.hiringRequisitionStatusHistory.create({
    data: { requisitionId: id, fromStatus: from, toStatus: to, changedById, reason },
  });
}

/**
 * Bell notice to the holders of the round's next unsigned step (UX review P0,
 * US-6) — on submission and after each intermediate sign-off. Never the
 * submitter or an earlier signer (they may not sign it). Never throws.
 */
export async function notifyNextRequisitionStep(
  req: Pick<HiringRequisition, "id" | "title">,
  subject: ScopeSubject,
): Promise<void> {
  try {
    const round = await latestRound(REQUISITION_SUBJECT, req.id);
    const step = round?.status === "PENDING" ? currentStep(round.steps) : undefined;
    if (!round || !step) return;
    const [routed] = await routeChain(
      [{ sequence: step.sequence, role: step.roleKey as HiringApprovalRole }],
      subject,
    );
    await notifyApprovalStep({
      what: "requisition",
      id: req.id,
      title: req.title,
      step: routed,
      round: round.id,
      exclude: [
        round.submittedById,
        ...round.decisions.flatMap((d) => [d.deciderId, d.onBehalfOfId]),
      ],
    });
  } catch {
    console.warn("[hiring] a requisition approval notice could not be prepared");
  }
}

function refusalError(e: unknown): never {
  if (!(e instanceof ApprovalRefusal)) throw e;
  if (e.code === "NOT_PENDING" || e.code === "CHANGED")
    throw new HiringRuleError(
      "This requisition changed since you loaded it — reload and retry.",
      409,
    );
  if (e.code === "NO_STEP")
    throw new HiringRuleError("No approval step is left to sign on this requisition.", 409);
  throw new HiringRuleError(requisitionRefusalMessage(e.code), 403);
}

/** Sign the round's current step; the last signature opens the requisition. */
async function signStep(
  actor: HiringActor,
  req: HiringRequisition,
  subject: ScopeSubject,
  reason: string,
): Promise<StatusResult> {
  const [round, delegators] = await Promise.all([
    latestRound(REQUISITION_SUBJECT, req.id),
    delegatorActors(actor),
  ]);
  if (round?.status === "PENDING" && !currentStep(round.steps))
    throw new HiringRuleError("No approval step is left to sign on this requisition.", 409);
  const refusal = requisitionRefusal(actor, delegators, round, subject);
  if (refusal) throw new HiringRuleError(refusal, 403);
  let result;
  try {
    result = await decide({
      subjectType: REQUISITION_SUBJECT,
      subjectId: req.id,
      actorId: actor.userId,
      action: "APPROVED",
      comment: reason,
      qualify: async (_r, s) =>
        qualifyForRole(actor, delegators, s.roleKey as HiringApprovalRole, subject),
      onOutcome: async (tx, outcome) => {
        if (outcome === "APPROVED")
          await moveStatus(tx, req.id, "PENDING_APPROVAL", "OPEN", actor.userId, reason);
      },
    });
  } catch (e) {
    refusalError(e);
  }
  if (result.outcome === "APPROVED") {
    await resolveUserNotices(`hiring:requisition:${req.id}:`);
    return { status: "OPEN" };
  }
  await notifyNextRequisitionStep(req, subject);
  return {
    status: "PENDING_APPROVAL",
    approvalStep: { signed: result.step.roleKey, next: result.next?.roleKey ?? null },
  };
}

/**
 * A routed approver's "Rejected — …" / "Sent back — …" is a decision on the
 * round's current step. Anything else that moves a pending requisition back to
 * draft (a manager withdrawing it, or a decline the engine would not record as
 * this person's decision) cancels the round instead — the move itself was
 * always allowed and still is. Null = not recorded as a decision.
 */
async function declineAsDecision(
  actor: HiringActor,
  req: HiringRequisition,
  subject: ScopeSubject,
  reason: string,
): Promise<StatusResult | null> {
  const { decision } = parseDecisionNote(reason);
  if (decision !== "REJECT" && decision !== "SEND_BACK") return null;
  const [round, delegators] = await Promise.all([
    latestRound(REQUISITION_SUBJECT, req.id),
    delegatorActors(actor),
  ]);
  if (requisitionRefusal(actor, delegators, round, subject) !== null) return null;
  try {
    await decide({
      subjectType: REQUISITION_SUBJECT,
      subjectId: req.id,
      actorId: actor.userId,
      action: decision === "REJECT" ? "REJECTED" : "SENT_BACK",
      comment: reason,
      qualify: async (_r, s) =>
        qualifyForRole(actor, delegators, s.roleKey as HiringApprovalRole, subject),
      onOutcome: async (tx) => {
        await moveStatus(tx, req.id, "PENDING_APPROVAL", "DRAFT", actor.userId, reason);
      },
    });
  } catch (e) {
    refusalError(e);
  }
  await resolveUserNotices(`hiring:requisition:${req.id}:`);
  return { status: "DRAFT" };
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
  const [round, delegators] = await Promise.all([
    latestRound(REQUISITION_SUBJECT, req.id),
    delegatorActors(actor),
  ]);
  const step = round?.status === "PENDING" ? currentStep(round.steps) : undefined;
  const q = step
    ? qualifyForRole(actor, delegators, step.roleKey as HiringApprovalRole, subject)
    : null;
  if (!isHiringAdmin(actor) && !q) {
    throw new HiringRuleError("Only the approver routed to this step can decide it.", 403);
  }
}
