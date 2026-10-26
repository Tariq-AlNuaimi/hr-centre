import type {
  JmlCaseStatus,
  JmlCaseType,
  JmlStage,
  JmlTaskStatus,
} from "@/generated/prisma/client";

/**
 * The JML vocabulary, per case type — kept VERBATIM from the two source
 * artifacts (Onboarding §7.4: approved names, statuses and stages may not be
 * renamed). Pure data, shared by services, routes and screens.
 */

/** Working stages in order (Onboarding §10.2; Offboarding §6.3). */
export const STAGE_ORDER: Record<JmlCaseType, readonly JmlStage[]> = {
  JOIN: ["PREBOARDING", "FIRST_DAY", "FIRST_WEEK"],
  MOVE: ["PREBOARDING", "FIRST_DAY", "FIRST_WEEK"],
  LEAVE: [
    "STAGE_1_RESIGNATION",
    "STAGE_2_IMMEDIATE",
    "STAGE_3_NOTICE_HANDOVER",
    "STAGE_4_SETTLEMENT",
  ],
};

export const FIRST_STAGE: Record<JmlCaseType, JmlStage> = {
  JOIN: "PREBOARDING",
  MOVE: "PREBOARDING",
  LEAVE: "STAGE_1_RESIGNATION",
};

/** The task statuses each artifact approved (Onboarding §10.3: 10; Offboarding §9.6: 14). */
export const TASK_STATUSES: Record<JmlCaseType, readonly JmlTaskStatus[]> = {
  JOIN: [
    "NOT_STARTED",
    "IN_PROGRESS",
    "WAITING_FOR_EMPLOYEE",
    "WAITING_FOR_IT",
    "WAITING_FOR_PRO",
    "WAITING_FOR_EXTERNAL",
    "COMPLETED",
    "NOT_APPLICABLE",
    "DELAYED",
    "CANCELLED",
  ],
  MOVE: [
    "NOT_STARTED",
    "IN_PROGRESS",
    "WAITING_FOR_EMPLOYEE",
    "WAITING_FOR_IT",
    "WAITING_FOR_PRO",
    "WAITING_FOR_EXTERNAL",
    "COMPLETED",
    "NOT_APPLICABLE",
    "DELAYED",
    "CANCELLED",
  ],
  LEAVE: [
    "NOT_STARTED",
    "IN_PROGRESS",
    "WAITING_FOR_EMPLOYEE",
    "WAITING_FOR_IT",
    "WAITING_FOR_PRO",
    "WAITING_FOR_LINE_MANAGER",
    "WAITING_FOR_FINANCE",
    "WAITING_FOR_ADMIN",
    "WAITING_FOR_MOL_COORDINATOR",
    "WAITING_FOR_APPROVAL",
    "COMPLETED",
    "NOT_APPLICABLE",
    "DELAYED",
    "CANCELLED",
  ],
};

/** A task that needs no more work. */
export const SETTLED_TASK_STATUSES: ReadonlySet<JmlTaskStatus> = new Set([
  "COMPLETED",
  "NOT_APPLICABLE",
  "CANCELLED",
]);

/** Cases with work in flight. */
export const LIVE_CASE_STATUSES: readonly JmlCaseStatus[] = [
  "ACTIVE",
  "AT_RISK",
  "PENDING_SETTLEMENT",
];

/** Terminal for the workflow (archive is possible from these). */
export const TERMINAL_CASE_STATUSES: readonly JmlCaseStatus[] = [
  "COMPLETED",
  "CLOSED",
  "CANCELLED",
  "ARCHIVED",
];

export const CASE_REF_PREFIX: Record<JmlCaseType, string> = {
  JOIN: "ONB",
  MOVE: "CHG",
  LEAVE: "EXIT",
};

export function isLive(status: JmlCaseStatus): boolean {
  return LIVE_CASE_STATUSES.includes(status);
}

export function isTerminal(status: JmlCaseStatus): boolean {
  return TERMINAL_CASE_STATUSES.includes(status);
}
