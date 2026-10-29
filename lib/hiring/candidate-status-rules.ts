import type { HiringStage } from "@/generated/prisma/client";

/**
 * P2-11 — the candidate-facing stage mapping, pure (no database, no env), so
 * the status page and its tests share one definition. See `candidate-status.ts`.
 */

/** The candidate-facing journey, in order. */
export const CANDIDATE_STEPS = ["RECEIVED", "REVIEW", "INTERVIEWS", "FINAL", "OFFER"] as const;
export type CandidateStep = (typeof CANDIDATE_STEPS)[number];
export type CandidateOutcome = "HIRED" | "NOT_PROGRESSING" | "WITHDRAWN" | null;

const STEP_OF: Record<HiringStage, CandidateStep> = {
  NEW_APPLICATION: "RECEIVED",
  CV_SCREENED: "REVIEW",
  SHORTLISTED: "REVIEW",
  ASSESSMENT: "REVIEW",
  FIRST_INTERVIEW: "INTERVIEWS",
  SECOND_INTERVIEW: "INTERVIEWS",
  FINAL_INTERVIEW: "INTERVIEWS",
  REFERENCE_CHECK: "FINAL",
  BACKGROUND_CHECK: "FINAL",
  DECISION_PENDING: "FINAL",
  // A drafted offer is internal until it is extended.
  OFFER_DRAFTED: "FINAL",
  OFFER_EXTENDED: "OFFER",
  OFFER_ACCEPTED: "OFFER",
  PRE_ONBOARDING: "OFFER",
  HIRED: "OFFER",
  REJECTED: "REVIEW",
  WITHDRAWN: "REVIEW",
};

/** Where the candidate is, in their words, and whether the application has ended. */
export function candidateFacingStage(params: {
  stage: HiringStage;
  rejectionNoticeSentAt: Date | null;
  stallCauseStage: HiringStage | null;
}): { step: CandidateStep; outcome: CandidateOutcome } {
  const { stage, rejectionNoticeSentAt, stallCauseStage } = params;
  if (stage === "REJECTED") {
    // Before the human notice: still "under review", at the step it stopped in.
    const at = stallCauseStage ? STEP_OF[stallCauseStage] : "REVIEW";
    return { step: at, outcome: rejectionNoticeSentAt ? "NOT_PROGRESSING" : null };
  }
  if (stage === "WITHDRAWN") {
    return { step: stallCauseStage ? STEP_OF[stallCauseStage] : "REVIEW", outcome: "WITHDRAWN" };
  }
  if (stage === "OFFER_ACCEPTED" || stage === "PRE_ONBOARDING" || stage === "HIRED") {
    return { step: "OFFER", outcome: "HIRED" };
  }
  return { step: STEP_OF[stage], outcome: null };
}
