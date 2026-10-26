import type { JmlCaseType, JmlStage, JmlTaskStatus } from "@/generated/prisma/client";
import { STAGE_ORDER } from "../vocab";

/**
 * Progress, stage and completion gates — one engine for every case type.
 *
 * Ported from HR Onboarding `task.ts` (§10.4, BR-013, deriveStage) and HR
 * Offboarding `progress.ts` / `gates.ts` (BR-OFF-018, AC-4.2–4.4). Where the two
 * artifacts genuinely differ, the difference is kept per case type and named:
 *
 *  - Empty denominator: JOIN/MOVE = 100 (nothing outstanding, Onboarding);
 *    LEAVE = 0 (a misconfigured template must not pass the closure gate,
 *    Offboarding).
 *  - CANCELLED: excluded for JOIN/MOVE (Onboarding); stays in the denominator
 *    for LEAVE (Offboarding — cancelled tasks only exist on a cancelled case).
 *  - Rounding: FLOORED for every type. Onboarding rounded, which turned 199/200
 *    into 100 and let `deriveStage` mark a case COMPLETED with a task open —
 *    the defect Offboarding's floor exists to prevent. Fixed, not copied.
 */

export type ProgressTask = { mandatory: boolean; status: JmlTaskStatus };

export function computeProgress(
  tasks: readonly ProgressTask[],
  caseType: JmlCaseType,
): { completionPct: number; applicable: number; completed: number } {
  const excluded: ReadonlySet<JmlTaskStatus> =
    caseType === "LEAVE" ? new Set(["NOT_APPLICABLE"]) : new Set(["NOT_APPLICABLE", "CANCELLED"]);
  const applicable = tasks.filter((t) => t.mandatory && !excluded.has(t.status));
  const completed = applicable.filter((t) => t.status === "COMPLETED").length;
  if (applicable.length === 0) {
    return { completionPct: caseType === "LEAVE" ? 0 : 100, applicable: 0, completed: 0 };
  }
  const completionPct =
    completed === applicable.length ? 100 : Math.floor((completed / applicable.length) * 100);
  return { completionPct, applicable: applicable.length, completed };
}

/**
 * BR-013: a joiner/mover case is complete at 100% AND, when the checklist has a
 * contract-signature task, with that task COMPLETED. Matched by name (both
 * §10.2 names — open question 2: which one is canonical).
 */
const CONTRACT_SIGNED_PATTERN = /contract\s+signed|sign\s+employment\s+contract/i;

type StageTask = ProgressTask & { stage: JmlStage; name: string };

export function isComplete(
  tasks: readonly StageTask[],
  caseType: JmlCaseType,
): { complete: boolean; reason?: string } {
  if (computeProgress(tasks, caseType).completionPct < 100) {
    return { complete: false, reason: "not all mandatory tasks are done" };
  }
  // The FIRST matching task must be COMPLETED (Onboarding's rule, verbatim).
  const contract = tasks.find((t) => CONTRACT_SIGNED_PATTERN.test(t.name));
  if (contract && contract.status !== "COMPLETED") {
    return { complete: false, reason: "the employment contract is not confirmed signed" };
  }
  return { complete: true };
}

const OPEN = (s: JmlTaskStatus) => s !== "COMPLETED" && s !== "NOT_APPLICABLE" && s !== "CANCELLED";

/**
 * JOIN/MOVE: the stage follows the work, not the calendar (Onboarding): the
 * first working stage with an outstanding applicable mandatory task, COMPLETED
 * when the case is complete.
 */
export function deriveJoinStage(tasks: readonly StageTask[], caseType: JmlCaseType): JmlStage {
  if (isComplete(tasks, caseType).complete) return "COMPLETED";
  for (const stage of STAGE_ORDER[caseType]) {
    if (tasks.some((t) => t.stage === stage && t.mandatory && OPEN(t.status))) return stage;
  }
  return "FIRST_WEEK";
}
