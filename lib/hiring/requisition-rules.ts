import type { HiringRequisitionStatus } from "@/generated/prisma/client";
import { decisionRefusal, type RefusalCode } from "@/lib/core/approvals/rules";

/**
 * Requisition lifecycle — pure rules (Interview Hub ADR-024 / ADR-063,
 * `lib/validations/position.ts`, `lib/services/hiring-request.ts`,
 * `lib/services/position-approval.ts`).
 */

export const REQUISITION_STATUSES: HiringRequisitionStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "OPEN",
  "ON_HOLD",
  "FILLED",
  "REOPENED",
  "CLOSED",
  "ARCHIVED",
];

/** Publishing is gated: DRAFT → PENDING_APPROVAL → OPEN. CLOSED is legacy, never a target. */
export const STATUS_TRANSITIONS: Record<HiringRequisitionStatus, HiringRequisitionStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "ARCHIVED"],
  PENDING_APPROVAL: ["OPEN", "DRAFT", "ARCHIVED"],
  OPEN: ["ON_HOLD", "FILLED", "ARCHIVED"],
  ON_HOLD: ["OPEN", "ARCHIVED"],
  FILLED: ["REOPENED", "ARCHIVED"],
  REOPENED: ["OPEN", "ON_HOLD", "FILLED", "ARCHIVED"],
  CLOSED: ["REOPENED", "ARCHIVED"],
  ARCHIVED: [],
};

export function isAllowedTransition(from: HiringRequisitionStatus, to: HiringRequisitionStatus) {
  return from !== to && STATUS_TRANSITIONS[from].includes(to);
}

/** The ten fields a requisition needs before an approver sees it (artboard T21). */
const REQUIRED_FIELDS = [
  "title",
  "entityId",
  "departmentId",
  "hiringManagerId",
  "openings",
  "targetCloseDate",
  "salaryBandMin",
  "salaryBandMax",
  "businessNeed",
  "alternativesConsidered",
] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

export type ReadinessInput = Partial<{
  title: string | null;
  entityId: string | null;
  departmentId: string | null;
  hiringManagerId: string | null;
  openings: number | null;
  targetCloseDate: Date | string | null;
  salaryBandMin: number | null;
  salaryBandMax: number | null;
  businessNeed: string | null;
  alternativesConsidered: string | null;
}>;

const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && !v.trim());

/**
 * Applied by the hiring-request submit AND every DRAFT → PENDING_APPROVAL move,
 * so a requisition can never reach an approver without the facts the approval
 * screen is built to show. Returns the failing fields (empty = ready).
 */
export function readinessProblems(input: ReadinessInput): RequiredField[] {
  const bad = new Set<RequiredField>(REQUIRED_FIELDS.filter((f) => blank(input[f])));
  if (
    typeof input.openings === "number" &&
    (!Number.isInteger(input.openings) || input.openings < 1)
  ) {
    bad.add("openings");
  }
  if (input.targetCloseDate && Number.isNaN(new Date(input.targetCloseDate).getTime())) {
    bad.add("targetCloseDate");
  }
  const { salaryBandMin: min, salaryBandMax: max } = input;
  if (typeof min === "number" && typeof max === "number" && min > max) bad.add("salaryBandMin");
  return REQUIRED_FIELDS.filter((f) => bad.has(f));
}

// --- Approver decision verbs (artboards T03 / T04 / T22) --------------------------
// Reject and send-back are the same transition (→ DRAFT) with different meanings;
// the verb rides as a stable prefix on the mandatory history note.

const REQUISITION_DECISIONS = ["APPROVE", "REJECT", "SEND_BACK"] as const;
export type RequisitionDecision = (typeof REQUISITION_DECISIONS)[number];

const DECISION_PREFIX: Record<RequisitionDecision, string> = {
  APPROVE: "Approved",
  REJECT: "Rejected",
  SEND_BACK: "Sent back",
};

export const DECISION_TARGET: Record<RequisitionDecision, "OPEN" | "DRAFT"> = {
  APPROVE: "OPEN",
  REJECT: "DRAFT",
  SEND_BACK: "DRAFT",
};

export function composeDecisionNote(decision: RequisitionDecision, note: string): string {
  return `${DECISION_PREFIX[decision]} — ${note.trim()}`;
}

export function parseDecisionNote(reason: string): {
  decision: RequisitionDecision | null;
  note: string;
} {
  for (const decision of REQUISITION_DECISIONS) {
    const prefix = `${DECISION_PREFIX[decision]} — `;
    if (reason.startsWith(prefix)) return { decision, note: reason.slice(prefix.length) };
  }
  return { decision: null, note: reason };
}

// --- Two-step sign-off (process step 2) ---------------------------------------------

export type SignedStep = { sequence: number; requiredRole: string; approverId?: string };

/** First chain step not yet signed — a step counts only if sequence AND role match. */
export function nextUnsignedStep<T extends { sequence: number; role: string }>(
  chain: T[],
  signed: SignedStep[],
): T | undefined {
  const done = new Set(signed.map((s) => `${s.sequence}::${s.requiredRole}`));
  return chain.find((s) => !done.has(`${s.sequence}::${s.role}`));
}

export function isFinalStep(chain: { sequence: number }[], step: { sequence: number }) {
  return chain.length > 0 && chain[chain.length - 1].sequence === step.sequence;
}

/** Hiring's sentences for the core engine's refusal codes (ADR-094), unchanged since ADR-063. */
export function requisitionRefusalMessage(code: RefusalCode): string {
  switch (code) {
    case "NO_SUBMITTER":
      return "Can't verify who submitted this requisition for approval, so it can't be signed — re-submit it for approval first.";
    case "SUBMITTER":
    case "EXCLUDED":
      return "You can't approve a requisition you submitted — it needs a different approver (segregation of duties).";
    case "PRIOR_STEP":
    case "ALREADY":
      return "You already signed an earlier step of this approval — the next step needs a different approver.";
    case "NOT_QUALIFIED":
      return "Only the approver routed to this step can sign it.";
  }
}

/**
 * Segregation of duties for a requisition step: never the submitter, never
 * someone who signed an earlier step of this round (not admin-overridable),
 * and only a routed approver (or their delegate) — or a hiring admin. The rule
 * is the core engine's (ADR-094); `actingForId` is the holder a delegate acts
 * for, held to the same bans.
 */
export function signRefusal(input: {
  actorId: string;
  isAdmin: boolean;
  requesterId: string | null;
  routedApproverIds: readonly string[];
  priorSignerIds: readonly string[];
  actingForId?: string | null;
}): string | null {
  const routed =
    input.routedApproverIds.includes(input.actorId) ||
    (Boolean(input.actingForId) && input.routedApproverIds.includes(input.actingForId!));
  const code = decisionRefusal({
    actorId: input.actorId,
    actingFor: input.actingForId ?? null,
    submitterId: input.requesterId,
    excludedIds: [],
    step: { sequence: 0 },
    decisions: input.priorSignerIds.map((id) => ({
      sequence: -1,
      deciderId: id,
      onBehalfOfId: null,
      action: "APPROVED" as const,
    })),
    qualified: routed || input.isAdmin,
  });
  return code ? requisitionRefusalMessage(code) : null;
}

/** Still being hired for (not drafted, filled or archived). */
const LIVE_STATUSES = new Set(["PENDING_APPROVAL", "OPEN", "ON_HOLD", "REOPENED"]);

/** A live requisition whose target close date has passed (UX review P1-12). */
export function isPastTargetClose(
  status: string,
  targetCloseDate: Date | string | null,
  now: number = Date.now(),
): boolean {
  if (!targetCloseDate || !LIVE_STATUSES.has(status)) return false;
  return new Date(targetCloseDate).getTime() < now;
}
