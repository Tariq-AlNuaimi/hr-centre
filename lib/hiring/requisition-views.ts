import { prisma } from "@/lib/prisma";
import { can, isHiringAdmin, type HiringActor } from "./access";
import { buildBudgetCheck, type BudgetEnvelopeEntry } from "./fill-rules";
import { toOMRorNull } from "./money";
import { peopleById, personOrNull } from "./people";
import { nextUnsignedStep, parseDecisionNote, signRefusal } from "./requisition-rules";
import { currentRound, requisitionChain } from "./requisition-status";
import { bandFor, type LoadedRequisition } from "./requisitions";
import { readSetting } from "./settings";

/** The step-2 approval screen (artboards T02/T03/T04/T22) and the status timeline. */

async function envelopeFor(entityId: string): Promise<BudgetEnvelopeEntry | null> {
  const [raw, entity] = await Promise.all([
    readSetting("budget.envelope"),
    prisma.orgEntity.findUnique({ where: { id: entityId }, select: { code: true } }),
  ]);
  const entities = (raw as { entities?: Record<string, BudgetEnvelopeEntry> } | null)?.entities;
  return (entity && entities?.[entity.code]) || null;
}

export async function approvalView(actor: HiringActor, l: LoadedRequisition) {
  const req = l.req;
  const [{ steps, threshold }, round, history, envelope] = await Promise.all([
    requisitionChain(req, l.subject),
    currentRound(req.id),
    statusHistory(req.id),
    envelopeFor(req.entityId),
  ]);
  // The latest round's signatures always show; "next" exists only while pending.
  const signedRows = req.status === "DRAFT" || req.status === "ARCHIVED" ? [] : round.signed;
  const next = req.status === "PENDING_APPROVAL" ? nextUnsignedStep(steps, signedRows) : undefined;
  const people = await peopleById([
    ...signedRows.map((s) => s.approverId),
    round.submission?.changedById,
  ]);
  const routedApprover = steps.some((s) => s.approvers.some((a) => a.id === actor.userId));
  const band = bandFor(actor, l, routedApprover);
  const refusal =
    req.status === "PENDING_APPROVAL" && next
      ? signRefusal({
          actorId: actor.userId,
          isAdmin: isHiringAdmin(actor),
          requesterId: round.submission?.changedById ?? null,
          routedApproverIds: next.approvers.map((a) => a.id),
          priorSignerIds: signedRows.map((s) => s.approverId),
        })
      : "This requisition is not awaiting approval.";
  const lastDecision = history.find((h) => h.fromStatus === "PENDING_APPROVAL");
  return {
    status: req.status,
    threshold,
    steps: steps.map((s) => {
      const hit = signedRows.find((r) => r.sequence === s.sequence && r.requiredRole === s.role);
      return {
        sequence: s.sequence,
        role: s.role,
        approvers: s.approvers,
        signedBy: hit ? personOrNull(people, hit.approverId) : null,
        signedAt: hit?.createdAt ?? null,
        comment: hit?.comment ?? null,
        isNext: next?.sequence === s.sequence,
      };
    }),
    submittedBy: personOrNull(people, round.submission?.changedById),
    submittedAt: round.submission?.changedAt ?? null,
    budget: band.bandHidden
      ? null
      : buildBudgetCheck({
          bandMaxOMR: toOMRorNull(band.salaryBandMax, req.salaryCurrency),
          openings: req.openings,
          envelope,
        }),
    band,
    lastDecision: lastDecision
      ? {
          ...parseDecisionNote(lastDecision.reason),
          toStatus: lastDecision.toStatus,
          at: lastDecision.changedAt,
          by: lastDecision.changedBy,
        }
      : null,
    can: {
      decide: refusal === null,
      decideRefusal: refusal,
      withdraw: can(actor, "hiring.manage", l.subject),
    },
    history,
  };
}

export async function statusHistory(requisitionId: string) {
  const rows = await prisma.hiringRequisitionStatusHistory.findMany({
    where: { requisitionId },
    orderBy: { changedAt: "desc" },
    take: 100,
  });
  const people = await peopleById(rows.map((r) => r.changedById));
  return rows.map((r) => ({
    id: r.id,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    reason: r.reason,
    changedAt: r.changedAt,
    changedBy: personOrNull(people, r.changedById),
  }));
}

const BAND_KEYS = ["salaryBandMin", "salaryBandMax"];

/**
 * The audit trail for one requisition (Interview Hub `/positions/[id]/history`).
 * The band is Restricted here (D19), so its before/after values are withheld
 * from readers who may not see pay.
 */
export async function auditTrail(requisitionId: string, showBand: boolean) {
  const rows = await prisma.auditLog.findMany({
    where: { entityType: "HiringRequisition", entityId: requisitionId },
    orderBy: { timestamp: "desc" },
    take: 200,
    select: { id: true, action: true, changes: true, actorEmail: true, timestamp: true },
  });
  if (showBand) return rows;
  return rows.map((r) => {
    const changes = (r.changes ?? {}) as Record<string, unknown>;
    return {
      ...r,
      changes: Object.fromEntries(
        Object.entries(changes).map(([k, v]) => [k, BAND_KEYS.includes(k) ? "[restricted]" : v]),
      ),
    };
  });
}
