import { Prisma, type HiringOfferStatus } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import type { HiringActor } from "./access";
import { computeChain, totalMonthlyComp } from "./approval-chain";
import { randomUUID } from "node:crypto";
import {
  assertChainStaffed,
  configToChainOptions,
  loadApprovalConfig,
  routeChain,
  type RoutedStep,
} from "./approval-config";
import { notifyApprovalStep } from "./notify";
import { applyStageChange, moveStage } from "./candidate-stage";
import { loadCandidate, seesCandidateComp } from "./candidates";
import { newHiringId, sealAmount, sealJson } from "./comp-crypto";
import { HiringRuleError } from "./http";
import { diffOfferTerms, type OfferTerms } from "./offer-package";
import { APPROVAL_BOUND_FIELDS, LIVE_OFFER_STATUSES, offerTransitionError } from "./offer-rules";
import { ensureInitialVersion, termsOf } from "./offer-versions";
import type { LoadedOffer } from "./offers";
import { stageRank } from "./stage-rules";

/**
 * Offer writes (Interview Hub `POST/PUT/DELETE /api/offers`). Fixes on the
 * way: the requisition is the candidate's own (Interview Hub took a client
 * position id without a scope check), drafting an offer IS the move to
 * "Offer drafted" — so the stage and package gates apply — and a candidate has
 * at most one live offer. Sending moves the candidate to "Offer extended".
 */

export type OfferBody = {
  salary?: number | null;
  allowances?: Record<string, number> | null;
  startDate?: Date;
  probationMonths?: number;
  noticePeriod?: string | null;
  contractType?: string | null;
  benefits?: string | null;
};

function sealedTerms(id: string, b: OfferBody) {
  return {
    ...(b.salary !== undefined ? { salaryEnc: sealAmount("offer", id, "salary", b.salary) } : {}),
    ...(b.allowances !== undefined
      ? { allowancesEnc: sealJson("offer", id, "allowances", b.allowances) }
      : {}),
    ...(b.startDate !== undefined ? { startDate: b.startDate } : {}),
    ...(b.probationMonths !== undefined ? { probationMonths: b.probationMonths } : {}),
    ...(b.noticePeriod !== undefined ? { noticePeriod: b.noticePeriod } : {}),
    ...(b.contractType !== undefined ? { contractType: b.contractType } : {}),
    ...(b.benefits !== undefined ? { benefits: b.benefits } : {}),
  };
}

export async function createOffer(
  actor: HiringActor,
  body: OfferBody & { candidateId: string; startDate: Date },
) {
  const l = await loadCandidate(actor, body.candidateId, "hiring.manage");
  if (!l) throw new HiringRuleError("That candidate was not found.", 404);
  const c = l.cand;
  if (!c.requisitionId)
    throw new HiringRuleError("Put the candidate on a requisition before drafting an offer.", 422);
  if (c.stage === "REJECTED" || c.stage === "WITHDRAWN") {
    throw new HiringRuleError(
      `${c.name} is no longer in the process. Reopen them before drafting an offer.`,
      422,
    );
  }
  const live = await prisma.hiringOffer.findFirst({
    where: { candidateId: c.id, deletedAt: null, status: { in: [...LIVE_OFFER_STATUSES] } },
    select: { id: true },
  });
  if (live)
    throw new HiringRuleError(
      `${c.name} already has an offer in progress. Open it instead of drafting another.`,
      409,
      "OFFER_EXISTS",
    );
  const seesPay = body.salary != null || body.allowances != null;
  if (seesPay && !seesCandidateComp(actor, l)) {
    throw new HiringRuleError(
      "You don't have access to compensation, so you can't set the pay on an offer.",
      403,
    );
  }
  // Seal first: a missing pay key refuses before anything moves.
  const id = newHiringId();
  const sealed = sealedTerms(id, body);
  // Drafting the offer is the move to OFFER_DRAFTED: stage and package gates apply here.
  if (stageRank(c.stage) < stageRank("OFFER_DRAFTED"))
    await moveStage(actor, l, { stage: "OFFER_DRAFTED" });
  await prisma.hiringOffer.create({
    data: {
      id,
      candidateId: c.id,
      requisitionId: c.requisitionId,
      startDate: body.startDate,
      ...sealed,
    },
    select: { id: true },
  });
  return { id };
}

/** Bound fields that actually change (PATCH semantics) — refused after drafting. */
function frozenChanges(l: LoadedOffer, body: OfferBody): string[] {
  const prev = { ...termsOf(l.offer) };
  const patch: OfferTerms = { ...body, startDate: body.startDate?.toISOString() };
  return diffOfferTerms(prev, patch).filter((f) =>
    (APPROVAL_BOUND_FIELDS as readonly string[]).includes(f),
  );
}

export async function updateOffer(
  actor: HiringActor,
  l: LoadedOffer,
  body: OfferBody & { status?: HiringOfferStatus },
) {
  const o = l.offer;
  const from = o.status;
  const to = body.status && body.status !== from ? body.status : null;
  if (to) {
    const err = offerTransitionError(from, to);
    if (err) throw new HiringRuleError(err, 409);
  }
  const changes = frozenChanges(l, body);
  if (from !== "DRAFTING" && changes.length) {
    throw new HiringRuleError(
      `This offer is ${from.toLowerCase().replace(/_/g, " ")}, so its approved terms can't be edited. Send it back to drafting first.`,
      409,
    );
  }
  if (!l.comp && (body.salary !== undefined || body.allowances !== undefined)) {
    throw new HiringRuleError(
      "You don't have access to compensation, so you can't change the pay.",
      403,
    );
  }
  const extra: Prisma.HiringOfferUpdateInput = {};
  let routed: RoutedStep[] | null = null;
  if (to === "PENDING_APPROVAL") {
    const terms = {
      ...termsOf(o),
      ...(body.salary !== undefined ? { salary: body.salary } : {}),
      ...(body.allowances !== undefined ? { allowances: body.allowances } : {}),
    };
    const chain = computeChain(
      l.entity?.code,
      totalMonthlyComp(terms.salary, terms.allowances),
      configToChainOptions(await loadApprovalConfig()),
    );
    // No dead-end approvals: every step needs someone (not the candidate's
    // referrer) who can decide it, or the offer would stall unseen.
    routed = await routeChain(chain, l.subject);
    assertChainStaffed(routed, [o.candidate.referredById]);
    Object.assign(extra, {
      submittedById: actor.userId,
      approvalChain: chain as unknown as Prisma.InputJsonValue,
    });
  }
  if (to === "DRAFTING") extra.approvalChain = Prisma.DbNull;
  await auditedTransaction(async (tx) => {
    if (to === "PENDING_APPROVAL" || to === "DRAFTING") {
      // A new round starts clean; the audit log keeps every earlier decision.
      const old = await tx.hiringOfferApproval.findMany({
        where: { offerId: o.id },
        select: { id: true },
        take: 50,
      });
      for (const a of old) await tx.hiringOfferApproval.delete({ where: { id: a.id } });
    }
    await tx.hiringOffer.update({
      where: { id: o.id, status: from },
      data: {
        ...(from === "DRAFTING" ? sealedTerms(o.id, body) : {}),
        ...(to ? { status: to } : {}),
        ...extra,
      },
      select: { id: true },
    });
    if (to === "SENT") await ensureInitialVersion(tx, l, actor);
  });
  if (to === "SENT")
    await syncCandidate(actor, l, "OFFER_EXTENDED", "Offer sent to the candidate.");
  // UX review P0 (US-6): the first step's holders hear it is their turn.
  if (to === "PENDING_APPROVAL" && routed) {
    await notifyApprovalStep({
      what: "offer",
      id: o.id,
      title: o.candidate.name,
      step: routed[0],
      round: randomUUID(),
      exclude: [o.candidate.referredById, actor.userId],
    });
  }
  return { status: to ?? from };
}

/** Move the candidate forward to follow the offer (never backward, never out of a terminal stage). */
async function syncCandidate(
  actor: HiringActor,
  l: LoadedOffer,
  toStage: "OFFER_EXTENDED",
  reason: string,
) {
  const c = await prisma.hiringCandidate.findUnique({
    where: { id: l.offer.candidateId },
    select: { id: true, stage: true, requisitionId: true, preferredAt: true },
  });
  if (
    !c ||
    c.stage === "REJECTED" ||
    c.stage === "WITHDRAWN" ||
    stageRank(c.stage) >= stageRank(toStage)
  )
    return;
  await applyStageChange({ cand: c, toStage, movedById: actor.userId, reason });
}

/** Only an offer that never reached the candidate, or ended without acceptance, can be deleted. */
export async function deleteOffer(actor: HiringActor, l: LoadedOffer) {
  if (!["DRAFTING", "WITHDRAWN", "DECLINED"].includes(l.offer.status)) {
    throw new HiringRuleError(
      "Withdraw the offer first. An offer in approval, approved, sent or accepted is kept on record.",
      409,
    );
  }
  await prisma.hiringOffer.update({
    where: { id: l.offer.id },
    data: { deletedAt: new Date(), deletedBy: actor.userId },
    select: { id: true },
  });
}
