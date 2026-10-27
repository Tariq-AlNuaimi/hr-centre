import type { JmlApprovalType } from "@/generated/prisma/client";

/**
 * §4.3 approvals — HR Offboarding `approvals.ts`, ported pure. Holders are
 * ROLES (AC-11.4 / BR-OFF-020), never named people. Offboarding F5 fixed: all
 * five types can be requested and decided, and Final Settlement Approval is two
 * holder rows (HR Manager AND Operations Director), not one click.
 */

export const TERMINATION_AUTHORISATION_HOLDERS = ["HR Manager", "Operations Director"] as const;

export const APPROVAL_HOLDERS: Record<JmlApprovalType, readonly string[]> = {
  EXIT_CONFIRMATION: ["Line Manager"],
  TERMINATION_AUTHORISATION: TERMINATION_AUTHORISATION_HOLDERS,
  EARLY_RELEASE_VIA_LEAVE: ["Line Manager", "Operations Director"],
  BACKFILL_DECISION: ["Operations Director"],
  FINAL_SETTLEMENT_APPROVAL: ["HR Manager", "Operations Director"],
};

export const APPROVAL_TYPES = Object.keys(APPROVAL_HOLDERS) as JmlApprovalType[];

const SECOND_LEVEL: ReadonlySet<string> = new Set([
  "TERMINATION_AUTHORISATION",
  "FINAL_SETTLEMENT_APPROVAL",
]);

export function requiresSecondLevelDelegate(type: string): boolean {
  return SECOND_LEVEL.has(type);
}

export type Problem = { field: string; message: string };

/** BR-OFF-021 / BR-OFF-032 — the authority (delegate) configuration. */
export function checkAuthorityConfig(
  input: { approvalType: string; delegateId: string | null; secondLevelDelegateId: string | null },
  context: { secondLevelIneligible: readonly string[] },
): Problem[] {
  const out: Problem[] = [];
  if (!(input.approvalType in APPROVAL_HOLDERS)) {
    out.push({
      field: "approvalType",
      message: `"${input.approvalType}" is not one of the five §4.3 approval types.`,
    });
  }
  if (!input.delegateId) {
    out.push({
      field: "delegateId",
      message:
        "A configured delegate is mandatory (BR-OFF-021). The Operations Director appears in four of five approval types, so one unavailable holder stalls all four at once.",
    });
  }
  if (requiresSecondLevelDelegate(input.approvalType)) {
    if (!input.secondLevelDelegateId) {
      out.push({
        field: "secondLevelDelegateId",
        message: `${input.approvalType.replaceAll("_", " ").toLowerCase()} requires a named second-level delegate at management level (BR-OFF-032).`,
      });
    } else if (context.secondLevelIneligible.includes(input.secondLevelDelegateId)) {
      out.push({
        field: "secondLevelDelegateId",
        message:
          "The second-level delegate cannot be someone who already holds this approval as HR Manager — an escalation route that leads back to the unavailable holder is not a route (BR-OFF-032).",
      });
    }
  }
  if (input.delegateId && input.delegateId === input.secondLevelDelegateId) {
    out.push({
      field: "secondLevelDelegateId",
      message:
        "The delegate and the second-level delegate are the same person, so the second level adds no fallback.",
    });
  }
  return out;
}

export function checkTerminationAuthorisation(
  approvals: readonly { approvalType: string; holderRoleKey: string; status: string }[],
): { granted: boolean; missingHolders: string[]; rejectedHolders: string[] } {
  return checkHolders("TERMINATION_AUTHORISATION", approvals);
}

/** Every holder of `type` must have GRANTED (both signatures — AC-1.3 / AC-10.8). */
export function checkHolders(
  type: JmlApprovalType,
  approvals: readonly { approvalType: string; holderRoleKey: string; status: string }[],
): { granted: boolean; missingHolders: string[]; rejectedHolders: string[] } {
  const relevant = approvals.filter((a) => a.approvalType === type);
  const missingHolders: string[] = [];
  const rejectedHolders: string[] = [];
  for (const holder of APPROVAL_HOLDERS[type]) {
    const record = relevant.find((a) => a.holderRoleKey === holder);
    if (record?.status === "GRANTED") continue;
    if (record?.status === "REJECTED") rejectedHolders.push(holder);
    missingHolders.push(holder);
  }
  return { granted: missingHolders.length === 0, missingHolders, rejectedHolders };
}

export type ApprovalDecision = {
  status: "GRANTED" | "REJECTED";
  decisionDate: Date | null;
  reference: string | null;
  comments: string | null;
};

export function decisionProblem(
  existing: { status: string; holderRoleKey: string; approvalType: string },
  d: ApprovalDecision,
): string | null {
  const type = existing.approvalType.replaceAll("_", " ").toLowerCase();
  if (existing.status !== "PENDING") {
    return `${existing.holderRoleKey}'s decision on this ${type} is already recorded as ${existing.status.toLowerCase()}.`;
  }
  if (!d.decisionDate) return "A decision date is required.";
  if (d.status === "GRANTED" && !d.reference?.trim()) {
    return `Granting the ${type} on behalf of the ${existing.holderRoleKey} requires a reference — the email, minute or signed memo the authorisation came from.`;
  }
  if (d.status === "REJECTED" && !d.comments?.trim())
    return "Recording a refusal requires the reason it was refused.";
  return null;
}

/** AC-11.3: a pending approval older than two working days earns a reminder. */
export function needsReminder(
  a: { status: string; requestedAt: Date },
  now: Date,
  workingDaysBetween: (from: Date, to: Date) => number,
  threshold = 2,
): boolean {
  return a.status === "PENDING" && workingDaysBetween(a.requestedAt, now) > threshold;
}
