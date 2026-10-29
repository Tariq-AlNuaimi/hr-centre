import { decisionRefusal, type RefusalCode } from "@/lib/core/approvals/rules";
import type { HiringOfferStatus } from "@/generated/prisma/client";

/**
 * Offer rules — pure (Interview Hub `lib/validations/offer.ts` +
 * `app/api/offers/[id]/approvals`). The status machine, which fields an
 * approval freezes, and who may decide an approval step.
 */

export const OFFER_STATUSES = [
  "DRAFTING",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT",
  "ACCEPTED",
  "DECLINED",
  "WITHDRAWN",
] as const satisfies readonly HiringOfferStatus[];

/** Moves the status menu may make. APPROVED comes only from the approval route; SENT→PENDING only from a revision. */
const TRANSITIONS: Record<HiringOfferStatus, readonly HiringOfferStatus[]> = {
  DRAFTING: ["PENDING_APPROVAL", "WITHDRAWN"],
  PENDING_APPROVAL: ["DRAFTING", "WITHDRAWN"],
  APPROVED: ["SENT", "WITHDRAWN"],
  SENT: ["DECLINED", "WITHDRAWN"],
  ACCEPTED: [],
  DECLINED: [],
  WITHDRAWN: [],
};

export function offerTransitions(from: HiringOfferStatus): readonly HiringOfferStatus[] {
  return TRANSITIONS[from];
}

export function offerTransitionError(
  from: HiringOfferStatus,
  to: HiringOfferStatus,
): string | null {
  if (from === to) return null;
  if (TRANSITIONS[from].includes(to)) return null;
  if (to === "APPROVED")
    return "An offer is approved by its approval chain, not by changing its status.";
  if (to === "ACCEPTED")
    return "Record the acceptance (joining date and signed letter) to accept an offer.";
  if (from === "SENT" && to === "PENDING_APPROVAL") {
    return "A sent offer is changed with “Send revised offer”, which keeps the earlier version and restarts approval only when pay changes.";
  }
  return `An offer cannot move from ${label(from)} to ${label(to)}.`;
}

const label = (s: string) => s.toLowerCase().replace(/_/g, " ");

/** Terms an approval attests to — frozen once the offer leaves drafting. */
export const APPROVAL_BOUND_FIELDS = [
  "salary",
  "allowances",
  "startDate",
  "probationMonths",
  "noticePeriod",
  "contractType",
  "benefits",
] as const;

export const LIVE_OFFER_STATUSES: readonly HiringOfferStatus[] = [
  "DRAFTING",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT",
];

export type OfferStep = { sequence: number; role: string };
export type OfferDecision = { sequence: number; approverId: string; action: string | null };

/** The first chain step without an APPROVED decision in this round. */
export function nextOfferStep<T extends OfferStep>(
  chain: readonly T[],
  decisions: readonly OfferDecision[],
): T | undefined {
  const approved = new Set(decisions.filter((d) => d.action === "APPROVED").map((d) => d.sequence));
  return chain.find((s) => !approved.has(s.sequence));
}

/** The core engine's refusal codes, in Hiring's words. */
export function offerRefusalMessage(code: RefusalCode): string {
  switch (code) {
    case "NO_SUBMITTER":
      return "Can't tell who submitted this offer for approval, so it can't be decided. Send it back to drafting and submit it again.";
    case "SUBMITTER":
      return "You submitted this offer, so it needs a different approver (segregation of duties).";
    case "EXCLUDED":
      return "You referred this candidate, so you can't approve their offer. A referral is a conflict of interest.";
    case "PRIOR_STEP":
      return "You approved an earlier step of this offer. The next step needs a different approver.";
    case "ALREADY":
      return "You have already decided this step.";
    case "NOT_QUALIFIED":
      return "Only someone who holds this step's approval role can decide it.";
  }
}

/**
 * Who may decide the next step. Never the submitter (segregation of duties),
 * never the referrer, never someone who approved an earlier step of this round
 * (D17 — Interview Hub had this for requisitions only), and only someone who
 * holds the step's role — or a hiring admin. The rule itself is the core
 * engine's (ADR-094); `actingForId` is the holder a delegate acts for, who is
 * held to the same bans.
 */
export function offerDecisionRefusal(input: {
  actorId: string;
  submitterId: string | null;
  referrerId: string | null;
  qualified: boolean;
  priorApproverIds: readonly string[];
  actingForId?: string | null;
}): string | null {
  const code = decisionRefusal({
    actorId: input.actorId,
    actingFor: input.actingForId ?? null,
    submitterId: input.submitterId,
    excludedIds: input.referrerId ? [input.referrerId] : [],
    step: { sequence: 0 },
    decisions: input.priorApproverIds.map((id) => ({
      sequence: -1,
      deciderId: id,
      onBehalfOfId: null,
      action: "APPROVED" as const,
    })),
    qualified: input.qualified,
  });
  return code ? offerRefusalMessage(code) : null;
}

/** The joining date on acceptance must be the offered start date (same calendar day in Muscat). */
export function sameMuscatDay(a: Date, b: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Muscat",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(a) === fmt.format(b);
}
