import type { HiringStage } from "@/generated/prisma/client";

/**
 * The candidate stage machine — Interview Hub `lib/stage-phases.ts` +
 * `lib/stage-gates.ts`, unchanged in behaviour. Pure, so the stage route, the
 * bulk path, the board and the contract tests all ask the same questions.
 */

export const PIPELINE_STAGES = [
  "NEW_APPLICATION",
  "CV_SCREENED",
  "SHORTLISTED",
  "ASSESSMENT",
  "FIRST_INTERVIEW",
  "SECOND_INTERVIEW",
  "FINAL_INTERVIEW",
  "REFERENCE_CHECK",
  "BACKGROUND_CHECK",
  "DECISION_PENDING",
  "OFFER_DRAFTED",
  "OFFER_EXTENDED",
  "OFFER_ACCEPTED",
  "PRE_ONBOARDING",
  "HIRED",
  "REJECTED",
  "WITHDRAWN",
] as const satisfies readonly HiringStage[];

export type Stage = (typeof PIPELINE_STAGES)[number];
type PipelinePhase = "Screening" | "Interviews" | "Offers" | "Onboarding" | "Terminal";

export const LINEAR_STAGES: readonly Stage[] = PIPELINE_STAGES.slice(0, 15);
export const TERMINAL_STAGES: ReadonlySet<Stage> = new Set(["REJECTED", "WITHDRAWN"]);

const STAGE_PHASE: Record<Stage, PipelinePhase> = {
  NEW_APPLICATION: "Screening",
  CV_SCREENED: "Screening",
  SHORTLISTED: "Screening",
  ASSESSMENT: "Screening",
  FIRST_INTERVIEW: "Interviews",
  SECOND_INTERVIEW: "Interviews",
  FINAL_INTERVIEW: "Interviews",
  REFERENCE_CHECK: "Interviews",
  BACKGROUND_CHECK: "Interviews",
  DECISION_PENDING: "Interviews",
  OFFER_DRAFTED: "Offers",
  OFFER_EXTENDED: "Offers",
  OFFER_ACCEPTED: "Offers",
  PRE_ONBOARDING: "Onboarding",
  HIRED: "Onboarding",
  REJECTED: "Terminal",
  WITHDRAWN: "Terminal",
};

export function isStage(v: unknown): v is Stage {
  return typeof v === "string" && (PIPELINE_STAGES as readonly string[]).includes(v);
}

function getPhase(stage: Stage): PipelinePhase {
  return STAGE_PHASE[stage];
}

export function stageRank(stage: Stage): number {
  return LINEAR_STAGES.indexOf(stage);
}

const FIRST_INTERVIEW_RANK = stageRank("FIRST_INTERVIEW");

export function isPastFirstInterview(stage: Stage): boolean {
  const r = stageRank(stage);
  return r >= FIRST_INTERVIEW_RANK;
}

export function isRegression(from: Stage, to: Stage): boolean {
  if (TERMINAL_STAGES.has(to)) return false;
  if (TERMINAL_STAGES.has(from)) return true; // reopening a closed candidate
  return stageRank(to) < stageRank(from);
}

export function isPhaseCross(from: Stage, to: Stage): boolean {
  if (TERMINAL_STAGES.has(from) || TERMINAL_STAGES.has(to)) return false;
  if (stageRank(to) <= stageRank(from)) return false;
  return getPhase(from) !== getPhase(to);
}

/** A governed move: one a bulk action must never make for a whole selection. */
export function classifyStageMove(from: Stage, to: Stage): string | null {
  if (to === "REJECTED" && isPastFirstInterview(from)) return "candidate.reject";
  if (isRegression(from, to)) return "stage.regress";
  if (isPhaseCross(from, to)) return "stage.phaseCross";
  return null;
}

/** The eight-step spine every screen shares (step 0 holds no candidate). */
export const HIRING_STEPS = [
  "Requisition",
  "Apply",
  "Screen",
  "Interview",
  "Evaluate",
  "Decide",
  "Offer",
  "Hire",
] as const;

const STAGE_STEP: Record<Stage, number> = {
  NEW_APPLICATION: 1,
  CV_SCREENED: 2,
  SHORTLISTED: 2,
  ASSESSMENT: 2,
  FIRST_INTERVIEW: 3,
  SECOND_INTERVIEW: 3,
  FINAL_INTERVIEW: 3,
  REFERENCE_CHECK: 4,
  BACKGROUND_CHECK: 4,
  DECISION_PENDING: 5,
  OFFER_DRAFTED: 6,
  OFFER_EXTENDED: 6,
  OFFER_ACCEPTED: 6,
  PRE_ONBOARDING: 7,
  HIRED: 7,
  REJECTED: -1,
  WITHDRAWN: -1,
};

export function stepForStage(stage?: string | null): number {
  const s = isStage(stage) ? STAGE_STEP[stage] : 0;
  return s < 0 ? 0 : s;
}

/** A card at Offer/Hire with no offer record sits in Decide on the board. */
export function boardStepForStage(stage: string | null | undefined, hasOffer: boolean): number {
  const step = stepForStage(stage);
  if (!hasOffer && (step === 6 || step === 7)) return 5;
  return step;
}

export const BOARD_STEPS = [1, 2, 3, 4, 5, 6, 7] as const;
export const RAIL_STEPS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export function stepEntryStage(step: number): Stage {
  return LINEAR_STAGES.find((st) => STAGE_STEP[st] === step) ?? "NEW_APPLICATION";
}

export function stageTransitionError(from: Stage, to: Stage): string | null {
  if (from === to) return "Candidate is already at this stage.";
  if (TERMINAL_STAGES.has(from) && TERMINAL_STAGES.has(to)) {
    return "Cannot move directly between terminal statuses — reactivate the candidate first.";
  }
  return null;
}

/** The stages a phase (step 1–7) holds — the list's phase filter (UX P1-7). */
export function stagesForStep(step: number): Stage[] {
  return LINEAR_STAGES.filter((st) => STAGE_STEP[st] === step);
}

/**
 * Whose move a card is waiting on (Greenhouse colours its board by next-action
 * owner; UX P1-8). Advisory display only — permissions decide who may act.
 */
export type NextOwner = "recruiter" | "manager" | "panel" | "candidate" | "approvers";

const STAGE_OWNER: Partial<Record<Stage, NextOwner>> = {
  NEW_APPLICATION: "recruiter",
  CV_SCREENED: "recruiter",
  SHORTLISTED: "manager",
  ASSESSMENT: "candidate",
  FIRST_INTERVIEW: "panel",
  SECOND_INTERVIEW: "panel",
  FINAL_INTERVIEW: "panel",
  REFERENCE_CHECK: "recruiter",
  BACKGROUND_CHECK: "recruiter",
  DECISION_PENDING: "manager",
  OFFER_DRAFTED: "approvers",
  OFFER_EXTENDED: "candidate",
  OFFER_ACCEPTED: "recruiter",
  PRE_ONBOARDING: "recruiter",
};

export function nextOwner(stage: string, hasOffer: boolean): NextOwner | null {
  if (!isStage(stage)) return null;
  // An offer stage with no offer record yet is the recruiter drafting one.
  if (!hasOffer && stepForStage(stage) >= 6) return stage === "HIRED" ? null : "recruiter";
  return STAGE_OWNER[stage] ?? null;
}
