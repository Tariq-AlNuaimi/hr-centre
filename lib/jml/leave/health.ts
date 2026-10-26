import type { JmlCaseStatus, JmlRagFlag, JmlStage } from "@/generated/prisma/client";

/**
 * Case health for a live exit (Offboarding F4: RAG and AT_RISK were never
 * written). Pure; the sweep applies it.
 *  - RED   — an open task more than 3 working days overdue (the escalation
 *            line, AC-18.3), or a statutory deadline breached.
 *  - AMBER — any open task overdue, or a statutory deadline within 3 working days.
 *  - GREEN — otherwise.
 * Status follows: RED ⇒ AT_RISK; otherwise Stage 4 with a settlement ⇒
 * PENDING_SETTLEMENT; otherwise ACTIVE. Only live statuses are ever touched.
 */

export const ESCALATION_WORKING_DAYS = 3;
export const STATUTORY_WATCH_WORKING_DAYS = 3;

export type HealthInput = {
  status: JmlCaseStatus;
  stage: JmlStage;
  settlementApplicable: boolean;
  /** Working days overdue per open task (0 or less = not overdue). */
  overdueWorkingDays: readonly number[];
  /** Working days left to the statutory deadline (negative = breached), null when none applies. */
  statutoryDaysLeft: number | null;
};

const LIVE: ReadonlySet<JmlCaseStatus> = new Set(["ACTIVE", "AT_RISK", "PENDING_SETTLEMENT"]);

export function leaveRag(h: HealthInput): JmlRagFlag {
  const worst = Math.max(0, ...h.overdueWorkingDays);
  const breached = h.statutoryDaysLeft !== null && h.statutoryDaysLeft < 0;
  if (worst > ESCALATION_WORKING_DAYS || breached) return "RED";
  const near = h.statutoryDaysLeft !== null && h.statutoryDaysLeft <= STATUTORY_WATCH_WORKING_DAYS;
  if (worst > 0 || near) return "AMBER";
  return "GREEN";
}

export function leaveHealth(h: HealthInput): { ragFlag: JmlRagFlag; status: JmlCaseStatus } {
  const ragFlag = leaveRag(h);
  if (!LIVE.has(h.status)) return { ragFlag, status: h.status };
  if (ragFlag === "RED") return { ragFlag, status: "AT_RISK" };
  if (h.stage === "STAGE_4_SETTLEMENT" && h.settlementApplicable)
    return { ragFlag, status: "PENDING_SETTLEMENT" };
  return { ragFlag, status: "ACTIVE" };
}
