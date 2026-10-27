import type { HiringCandidate } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { loadWorkingCalendar } from "@/lib/working-time/load";
import { canOverrideGates, type HiringActor } from "./access";
import type { LoadedCandidate } from "./candidates";
import { occupiesSeat } from "./fill-rules";
import { HiringRuleError } from "./http";
import { computeHoldExpiry, furthestStageReached, shouldHoldNotice } from "./notice-rules";
import { syncRequisitionFill } from "./requisition-status";
import { gateVerdict, mayCrossGates, packageGateBlocks, skippedGates } from "./stage-gates";
import { stageRank, stageTransitionError, type Stage } from "./stage-rules";
import { handToJml, withdrawFromJml, type HandoffResult } from "./prejoiner";

/**
 * Moving a candidate — Interview Hub `candidate-stage.ts` + the stage route.
 * Every path that changes a stage (profile rail, board drag, bulk, screening,
 * assessment) goes through `applyStageChange`, so the side effects cannot be
 * forgotten by one of them.
 */

const OFFER_PENDING: Stage[] = ["OFFER_DRAFTED", "OFFER_EXTENDED"];
const PREFERRED_SETTLED: Stage[] = [
  "OFFER_ACCEPTED",
  "PRE_ONBOARDING",
  "HIRED",
  "REJECTED",
  "WITHDRAWN",
];
const HOLD_RELEASE_CAP = 100;

export async function stageHistoryFor(ids: readonly string[]) {
  const out = new Map<string, { fromStage: Stage; toStage: Stage }[]>();
  if (ids.length === 0) return out;
  const rows = await prisma.hiringStageHistory.findMany({
    where: { candidateId: { in: [...ids] } },
    select: { candidateId: true, fromStage: true, toStage: true },
    distinct: ["candidateId", "fromStage", "toStage"],
    take: 5000,
  });
  for (const r of rows) {
    const list = out.get(r.candidateId) ?? [];
    list.push({ fromStage: r.fromStage, toStage: r.toStage });
    out.set(r.candidateId, list);
  }
  return out;
}

/** Someone else on the requisition is in offer, or preferred and not yet settled. */
async function preferredCandidatePending(requisitionId: string | null, excludeId: string) {
  if (!requisitionId) return false;
  const n = await prisma.hiringCandidate.count({
    where: {
      requisitionId,
      id: { not: excludeId },
      OR: [
        { stage: { in: OFFER_PENDING } },
        { preferredAt: { not: null }, stage: { notIn: PREFERRED_SETTLED } },
      ],
    },
  });
  return n > 0;
}

/** The preferred candidate is settled: held finalists' notices are ready now. */
export async function releaseHoldsForRequisition(requisitionId: string, excludeId?: string) {
  const held = await prisma.hiringCandidate.findMany({
    where: {
      requisitionId,
      rejectionHoldUntil: { not: null },
      rejectionNoticeSentAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
    take: HOLD_RELEASE_CAP,
  });
  for (const { id } of held) {
    await prisma.hiringCandidate.update({
      where: { id },
      data: { rejectionHoldUntil: null },
      select: { id: true },
    });
  }
  return held.length;
}

export type ApplyStageChange = {
  cand: Pick<HiringCandidate, "id" | "stage" | "requisitionId" | "preferredAt">;
  toStage: Stage;
  movedById: string;
  reason?: string | null;
};

const STALL_CLEARED = {
  stallCause: null,
  stallNote: null,
  stallCauseAt: null,
  stallCauseById: null,
  stallCauseStage: null,
} as const;

export async function applyStageChange(input: ApplyStageChange) {
  const { cand, toStage, movedById } = input;
  const reason = input.reason?.trim() || null;
  await auditedTransaction(async (tx) => {
    // CAS on the stage read: a concurrent move answers 409, not a lost update.
    await tx.hiringCandidate.update({
      where: { id: cand.id, stage: cand.stage },
      data: {
        stage: toStage,
        ...STALL_CLEARED,
        ...(toStage === "REJECTED" && reason ? { rejectionReason: reason } : {}),
      },
      select: { id: true },
    });
    await tx.hiringStageHistory.create({
      data: { candidateId: cand.id, fromStage: cand.stage, toStage, movedById, reason },
    });
  });
  return afterStageChange(input);
}

async function afterStageChange({ cand, toStage, movedById }: ApplyStageChange) {
  if (toStage === "REJECTED") await maybeHoldNotice(cand);
  const leaving = toStage === "REJECTED" || toStage === "WITHDRAWN";
  if (leaving && cand.preferredAt) {
    await prisma.hiringCandidate.update({
      where: { id: cand.id },
      data: {
        preferredAt: null,
        preferredById: null,
        preferredNote: null,
        preferredOutstandingScorecards: null,
      },
      select: { id: true },
    });
    if (cand.requisitionId) await releaseHoldsForRequisition(cand.requisitionId, cand.id);
  }
  if (toStage === "OFFER_ACCEPTED" && cand.requisitionId) {
    await releaseHoldsForRequisition(cand.requisitionId, cand.id);
  }
  // Step 14 (ADR-082 D8): every path to OFFER_ACCEPTED hands the joiner to JML;
  // leaving after acceptance withdraws the onboarding draft.
  let handoff: HandoffResult | null = null;
  if (toStage === "OFFER_ACCEPTED") handoff = await handToJml(cand.id, movedById);
  if (leaving && stageRank(cand.stage) >= stageRank("OFFER_ACCEPTED")) {
    await withdrawFromJml(
      cand.id,
      movedById,
      `Candidate ${toStage === "REJECTED" ? "rejected" : "withdrew"} after accepting the offer`,
    );
  }
  const was = occupiesSeat(cand.stage);
  const now = occupiesSeat(toStage);
  if (was !== now) {
    await syncRequisitionFill(cand.requisitionId, {
      actorId: movedById,
      seatReleased: was && !now,
    });
  }
  return { handoff };
}

/** A finalist rejected while someone else's offer is open is held 5 working days. */
async function maybeHoldNotice(cand: ApplyStageChange["cand"]) {
  const history = await stageHistoryFor([cand.id]);
  const reached = furthestStageReached(cand.stage, history.get(cand.id) ?? []);
  const pending = await preferredCandidatePending(cand.requisitionId, cand.id);
  if (!shouldHoldNotice({ reached, preferredCandidatePending: pending })) return;
  const calendar = await loadWorkingCalendar();
  await prisma.hiringCandidate.update({
    where: { id: cand.id },
    data: { rejectionHoldUntil: computeHoldExpiry(new Date(), calendar) },
    select: { id: true },
  });
}

/** The set of stages a candidate has ever been at (for the gate check). */
async function visitedStages(cand: Pick<HiringCandidate, "id" | "stage">) {
  const history = await stageHistoryFor([cand.id]);
  return new Set<Stage>([
    cand.stage,
    ...(history.get(cand.id) ?? []).flatMap((h) => [h.fromStage, h.toStage]),
  ]);
}

/**
 * The stage route: transition legality, then the mandatory-step and package
 * gates (HR Manager + confirmation + reason to skip), then the move.
 */
export async function moveStage(
  actor: HiringActor,
  l: LoadedCandidate,
  body: { stage: Stage; reason?: string; overrideGates?: boolean },
) {
  const from = l.cand.stage;
  const to = body.stage;
  if (from === to) return { handoff: null };
  const illegal = stageTransitionError(from, to);
  if (illegal) throw new HiringRuleError(illegal, 422);
  const gaps = mayCrossGates(from, to) ? skippedGates(from, to, await visitedStages(l.cand)) : [];
  const verdict = gateVerdict({
    gaps,
    packageBlocked: packageGateBlocks(to, l.cand),
    mayOverride: canOverrideGates(actor, l.subject),
    overrideGates: body.overrideGates,
    reason: body.reason,
  });
  if (!verdict.ok) throw new HiringRuleError(verdict.message, verdict.status, verdict.code);
  return applyStageChange({
    cand: l.cand,
    toStage: to,
    movedById: actor.userId,
    reason: verdict.historyReason,
  });
}

/** Record (or clear) why a candidate is stuck at their CURRENT stage. */
export async function setStallCause(
  actor: HiringActor,
  l: LoadedCandidate,
  body: { cause: HiringCandidate["stallCause"]; note?: string },
) {
  const c = l.cand;
  try {
    await prisma.hiringCandidate.update({
      where: { id: c.id, stage: c.stage },
      data: body.cause
        ? {
            stallCause: body.cause,
            stallNote: body.note || null,
            stallCauseAt: new Date(),
            stallCauseById: actor.userId,
            stallCauseStage: c.stage,
          }
        : STALL_CLEARED,
      select: { id: true },
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2025") {
      throw new HiringRuleError(
        "This candidate moved to a different stage while you were writing — reload and record the reason against where they are now.",
        409,
      );
    }
    throw e;
  }
}
