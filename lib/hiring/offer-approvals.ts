import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ApprovalRefusal, decide, latestRound } from "@/lib/core/approvals/store";
import type { HiringActor } from "./access";
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
import { nextOfferStep, offerDecisionRefusal, offerRefusalMessage } from "./offer-rules";
import { OFFER_SUBJECT, delegatorActors, qualifyForRole, roundDecisions } from "./offer-round";
import { offerPay, type LoadedOffer } from "./offers";
import { notifyApprovalStep, notifyOfferDecided } from "./notify";
import { resolveUserNotices } from "@/lib/core/notify/user-notify";
import { orgNames, peopleById } from "./people";

/**
 * The offer's approval chain (step 11) — Interview Hub
 * `/api/offers/[id]/approvals`. The chain is the submit-time snapshot; before
 * submission it is a preview of what submitting would route. D17: nobody
 * approves two steps of the same round.
 *
 * Rounds and decisions live in the core approvals engine (ADR-094,
 * `lib/core/approvals`); this file keeps Hiring's chain, holders and sentences.
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
  const [routed, round, delegators] = await Promise.all([
    routeChain(steps, l.subject),
    latestRound(OFFER_SUBJECT, o.id),
    delegatorActors(actor),
  ]);
  const decisions = roundDecisions(round);
  const people = await peopleById([...decisions.map((d) => d.approverId), o.submittedById]);
  const referrer = o.candidate.referredById;
  const pending = o.status === "PENDING_APPROVAL";
  const next = pending ? nextOfferStep(routed, decisions) : undefined;
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
  const refusal = next ? refusalFor(actor, delegators, l, next, round) : null;
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

/** Why the actor may not decide `step` now (Hiring's sentence), or null. */
function refusalFor(
  actor: HiringActor,
  delegators: readonly HiringActor[],
  l: LoadedOffer,
  step: { sequence: number; role: Parameters<typeof qualifyForRole>[2] },
  round: Awaited<ReturnType<typeof latestRound>>,
) {
  const q = qualifyForRole(actor, delegators, step.role, l.subject);
  const decided = round?.status === "PENDING" ? round.decisions : [];
  return offerDecisionRefusal({
    actorId: actor.userId,
    actingForId: q?.onBehalfOfId ?? null,
    submitterId: l.offer.submittedById,
    referrerId: l.offer.candidate.referredById,
    qualified: q !== null,
    priorApproverIds: decided
      .filter((d) => d.action === "APPROVED" && d.step.sequence !== step.sequence)
      .flatMap((d) => [d.deciderId, d.onBehalfOfId].filter((x): x is string => Boolean(x))),
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
  // Refusals first, then the reason check — the order users saw before ADR-094.
  const [round, delegators] = await Promise.all([
    latestRound(OFFER_SUBJECT, o.id),
    delegatorActors(actor),
  ]);
  const pendingStep = nextOfferStep(steps, roundDecisions(round));
  if (!pendingStep) throw new HiringRuleError("Every step of this offer is already approved.", 409);
  const refusal = refusalFor(actor, delegators, l, pendingStep, round);
  if (refusal) throw new HiringRuleError(refusal, 403);
  if (body.action !== "APPROVED" && !body.comment?.trim()) {
    throw new HiringRuleError(
      "Say why, so the person who drafted the offer knows what to change.",
      400,
    );
  }
  let result;
  try {
    result = await decide({
      subjectType: OFFER_SUBJECT,
      subjectId: o.id,
      actorId: actor.userId,
      action: body.action,
      comment: body.comment,
      qualify: async (_round, s) =>
        qualifyForRole(actor, delegators, s.roleKey as (typeof steps)[number]["role"], l.subject),
      onOutcome: async (tx, outcome) => {
        if (outcome === "APPROVED" || outcome === "REJECTED" || outcome === "SENT_BACK") {
          await tx.hiringOffer.update({
            where: { id: o.id, status: "PENDING_APPROVAL" },
            data:
              outcome === "APPROVED"
                ? { status: "APPROVED" }
                : { status: "DRAFTING", approvalChain: Prisma.DbNull },
            select: { id: true },
          });
        }
      },
    });
  } catch (e) {
    if (!(e instanceof ApprovalRefusal)) throw e;
    if (e.code === "NOT_PENDING" || e.code === "CHANGED")
      throw new HiringRuleError("This offer changed since you loaded it — reload and retry.", 409);
    if (e.code === "NO_STEP")
      throw new HiringRuleError("Every step of this offer is already approved.", 409);
    throw new HiringRuleError(offerRefusalMessage(e.code), 403);
  }
  const step = steps.find((s) => s.sequence === result.step.sequence) ?? {
    sequence: result.step.sequence,
    role: result.step.roleKey as (typeof steps)[number]["role"],
  };
  const final = result.outcome === "APPROVED";
  const back = body.action !== "APPROVED";
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
