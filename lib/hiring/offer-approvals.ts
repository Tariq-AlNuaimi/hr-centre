import { Prisma } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { actsAs, isHiringAdmin, type HiringActor } from "./access";
import { chainFromSnapshot, computeChain, totalMonthlyComp } from "./approval-chain";
import {
  configToChainOptions,
  getRoutedChain,
  loadApprovalConfig,
  routeChain,
} from "./approval-config";
import { loadCandidate } from "./candidates";
import { HiringRuleError } from "./http";
import { toNum } from "./money";
import { bandVerdict } from "./offer-package";
import { nextOfferStep, offerDecisionRefusal } from "./offer-rules";
import { offerPay, type LoadedOffer } from "./offers";
import { notifyApprovalStep, notifyOfferDecided } from "./notify";
import { resolveUserNotices } from "@/lib/notifications/user-notify";
import { orgNames, peopleById } from "./people";

/**
 * The offer's approval chain (step 11) — Interview Hub
 * `/api/offers/[id]/approvals`. The chain is the submit-time snapshot; before
 * submission it is a preview of what submitting would route. D17: nobody
 * approves two steps of the same round.
 */

async function chainFor(l: LoadedOffer) {
  const snap = chainFromSnapshot(l.offer.approvalChain);
  if (snap) return { steps: snap, preview: false };
  const pay = offerPay(l.offer);
  const steps = computeChain(
    l.entity?.code,
    totalMonthlyComp(pay.salary, pay.allowances),
    configToChainOptions(await loadApprovalConfig()),
  );
  return { steps, preview: true };
}

export async function approvalView(actor: HiringActor, l: LoadedOffer) {
  const o = l.offer;
  const { steps, preview } = await chainFor(l);
  const [routed, decisions] = await Promise.all([
    routeChain(steps, l.subject),
    prisma.hiringOfferApproval.findMany({
      where: { offerId: o.id },
      orderBy: { sequence: "asc" },
      take: 50,
    }),
  ]);
  const people = await peopleById([...decisions.map((d) => d.approverId), o.submittedById]);
  const referrer = o.candidate.referredById;
  const pending = o.status === "PENDING_APPROVAL";
  const next = pending
    ? nextOfferStep(
        routed,
        decisions.map((d) => ({
          sequence: d.sequence ?? 0,
          approverId: d.approverId,
          action: d.action,
        })),
      )
    : undefined;
  const chain = routed.map((s) => {
    const d = decisions.find((x) => x.sequence === s.sequence);
    const approvers = s.approvers.filter((a) => a.id !== referrer);
    return {
      sequence: s.sequence,
      role: s.role,
      approvers,
      recused: approvers.length === 0 && s.approvers.length > 0,
      state: d?.action ?? (next?.sequence === s.sequence ? "AWAITING" : "PENDING"),
      decidedBy: d ? (people.get(d.approverId)?.name ?? null) : null,
      decidedAt: d?.decidedAt ?? null,
      comment: d?.comment ?? null,
    };
  });
  const refusal = next ? decisionRefusal(actor, l, next.role, decisions) : null;
  const pay = l.comp ? offerPay(o) : null;
  return {
    preview,
    status: o.status,
    chain,
    nextSequence: next?.sequence ?? null,
    canDecide: Boolean(next) && refusal === null,
    refusal: next ? refusal : null,
    submittedBy: o.submittedById ? (people.get(o.submittedById)?.name ?? null) : null,
    submittedByYou: o.submittedById === actor.userId,
    checklist: {
      packageConfirmed: await packageConfirmed(o.candidateId),
      band: pay
        ? bandVerdict(
            pay.salary,
            toNum(l.offer.requisition.salaryBandMin),
            toNum(l.offer.requisition.salaryBandMax),
          )
        : null,
    },
  };
}

async function packageConfirmed(candidateId: string) {
  const c = await prisma.hiringCandidate.findUnique({
    where: { id: candidateId },
    select: { packageStatus: true },
  });
  return c?.packageStatus ?? null;
}

function decisionRefusal(
  actor: HiringActor,
  l: LoadedOffer,
  role: Parameters<typeof actsAs>[1],
  decisions: readonly { approverId: string; action: string | null }[],
) {
  return offerDecisionRefusal({
    actorId: actor.userId,
    submitterId: l.offer.submittedById,
    referrerId: l.offer.candidate.referredById,
    qualified: isHiringAdmin(actor) || actsAs(actor, role, l.subject),
    priorApproverIds: decisions.filter((d) => d.action === "APPROVED").map((d) => d.approverId),
  });
}

export async function decideOffer(
  actor: HiringActor,
  l: LoadedOffer,
  body: { action: "APPROVED" | "REJECTED" | "SENT_BACK"; comment?: string },
) {
  const o = l.offer;
  if (o.status !== "PENDING_APPROVAL")
    throw new HiringRuleError("This offer is not waiting for approval.", 409);
  const steps = chainFromSnapshot(o.approvalChain);
  if (!steps)
    throw new HiringRuleError(
      "This offer has no valid approval chain. Send it back to drafting and submit it again.",
      409,
    );
  const decisions = await prisma.hiringOfferApproval.findMany({
    where: { offerId: o.id },
    take: 50,
  });
  const step = nextOfferStep(
    steps,
    decisions.map((d) => ({
      sequence: d.sequence ?? 0,
      approverId: d.approverId,
      action: d.action,
    })),
  );
  if (!step) throw new HiringRuleError("Every step of this offer is already approved.", 409);
  const refusal = decisionRefusal(actor, l, step.role, decisions);
  if (refusal) throw new HiringRuleError(refusal, 403);
  if (body.action !== "APPROVED" && !body.comment?.trim()) {
    throw new HiringRuleError(
      "Say why, so the person who drafted the offer knows what to change.",
      400,
    );
  }
  const final = body.action === "APPROVED" && steps[steps.length - 1].sequence === step.sequence;
  const back = body.action !== "APPROVED";
  await auditedTransaction(async (tx) => {
    if (back) {
      const others = decisions.filter((d) => d.sequence !== step.sequence);
      for (const d of others) await tx.hiringOfferApproval.delete({ where: { id: d.id } });
    }
    await tx.hiringOfferApproval.create({
      data: {
        offerId: o.id,
        approverId: actor.userId,
        sequence: step.sequence,
        requiredRole: step.role,
        action: body.action,
        comment: body.comment?.trim() || null,
        decidedAt: new Date(),
      },
      select: { id: true },
    });
    if (final || back) {
      await tx.hiringOffer.update({
        where: { id: o.id, status: "PENDING_APPROVAL" },
        data: final ? { status: "APPROVED" } : { status: "DRAFTING", approvalChain: Prisma.DbNull },
        select: { id: true },
      });
    }
  });
  await notifyAfterDecision(actor, l, steps, step, body.action, final);
  return {
    status: final ? "APPROVED" : back ? "DRAFTING" : "PENDING_APPROVAL",
    decided: step.role,
  };
}

/**
 * UX review P0 (US-6): after a decision, the next step's holders hear it is
 * their turn; on the final approval, a rejection or a send-back, the person who
 * submitted the offer hears the outcome. Never throws (notifyUsers swallows).
 */
async function notifyAfterDecision(
  actor: HiringActor,
  l: LoadedOffer,
  steps: NonNullable<ReturnType<typeof chainFromSnapshot>>,
  decided: { sequence: number },
  action: "APPROVED" | "REJECTED" | "SENT_BACK",
  final: boolean,
) {
  const o = l.offer;
  // QA D-14: the decided step's "waiting on you" notices are done.
  await resolveUserNotices(`hiring:offer:${o.id}:`);
  if (action === "APPROVED" && !final) {
    const nextStep = steps.find((s) => s.sequence > decided.sequence);
    if (!nextStep) return;
    const [routed] = await routeChain([nextStep], l.subject).catch(() => [undefined]);
    await notifyApprovalStep({
      what: "offer",
      id: o.id,
      title: o.candidate.name,
      step: routed,
      round: `${o.submittedById ?? "x"}:${decided.sequence}:${Date.now()}`,
      exclude: [o.candidate.referredById, o.submittedById, actor.userId],
    });
    return;
  }
  await notifyOfferDecided({
    offerId: o.id,
    candidateName: o.candidate.name,
    submitterId: o.submittedById,
    outcome: action,
    deciderId: actor.userId,
  });
}

/** What submitting would route, for the offer form (Interview Hub `ApprovalChainPreview`). */
export async function previewChain(actor: HiringActor, candidateId: string, total: number | null) {
  const l = await loadCandidate(actor, candidateId, "hiring.manage");
  if (!l?.cand.requisition) return null;
  const { entities } = await orgNames([l.cand.requisition.entityId], []);
  const code = entities.get(l.cand.requisition.entityId)?.code ?? "";
  const { steps, threshold } = await getRoutedChain(code, l.subject, total);
  const referrer = l.cand.referredById;
  return {
    threshold,
    steps: steps.map((s) => {
      const approvers = s.approvers.filter((a) => a.id !== referrer);
      return {
        sequence: s.sequence,
        role: s.role,
        approvers,
        recused: approvers.length === 0 && s.approvers.length > 0,
      };
    }),
  };
}
