import type { CycleStageKind } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";

/**
 * §13.4 — the status engine.
 *
 * "The dashboard is a role-scoped view of ONE shared status engine: manager sees
 * their chain, HR sees org-wide. Not separate builds — one engine, filtered by
 * role."
 *
 * So this file answers "where does this participant stand" once, and the
 * manager workspace (§13.3), the HR cycle-progress report (§13.5) and the
 * executive dashboard (§13.6) all read the SAME answer. The only thing that
 * differs between them is WHICH employee ids are fed in — the filter is applied
 * at the query, never inside the derivation, so the three views can never
 * disagree about what "signed" means.
 *
 * Everything here is pure. The route supplies the rows and the clock.
 */

/** Where one participant stands at one stage. Ordered as the process runs. */
export type StepState =
  | "NOT_APPLICABLE"
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "AWAITING_EMPLOYEE"
  | "AWAITING_MANAGER"
  | "AWAITING_HR"
  | "COMPLETE";

export type ParticipantStatusInput = {
  participantId: string;
  employeeId: string;
  name: string;
  employeeNumber: string;
  managerId: string | null;
  managerName: string | null;
  department: string | null;
  entity: string | null;
  /** §8.3 — C-Level skip goal-setting entirely. */
  goalSettingExempt: boolean;
  kpiCount: number;
  weightageTotal: Prisma.Decimal;
  goalsApprovedAt: Date | null;
  goalSetting: { employeeSignedAt: Date | null; managerSignedAt: Date | null };
  yearEnd: { employeeSignedAt: Date | null; managerSignedAt: Date | null };
  /** How many KPIs carry a rating from each party (§7.1). */
  selfRatedCount: number;
  managerRatedCount: number;
  /** Set once §10 has run for this employee; null before then. */
  band: string | null;
  score: Prisma.Decimal | null;
};

export type ParticipantStatus = ParticipantStatusInput & {
  goalSettingState: StepState;
  yearEndState: StepState;
  /** §5.3 — a set is only signable at exactly 100%. */
  weightageComplete: boolean;
  /** Spec's own wording for a stage that locked with a party still owing. */
  outstandingLabel: string | null;
};

const HUNDRED = new Prisma.Decimal(100);

/**
 * §5.1's order: draft → both sign → HR approves (the lock).
 *
 * HR approval is checked FIRST because it is the terminal state — a set that is
 * approved is complete regardless of how the signatures got there, and §5.4's
 * "Employee did not sign" path reaches approval with one signature missing.
 */
export function goalSettingState(row: ParticipantStatusInput): StepState {
  if (row.goalSettingExempt) return "NOT_APPLICABLE";
  if (row.goalsApprovedAt) return "COMPLETE";
  if (row.kpiCount === 0) return "NOT_STARTED";
  if (!row.weightageTotal.equals(HUNDRED)) return "IN_PROGRESS";
  if (!row.goalSetting.managerSignedAt) return "AWAITING_MANAGER";
  if (!row.goalSetting.employeeSignedAt) return "AWAITING_EMPLOYEE";
  return "AWAITING_HR";
}

/**
 * §7.1's order: employee self-assesses → manager reviews → both sign.
 *
 * "NOT_APPLICABLE" for an exempt participant AND for one whose baseline was
 * never locked: there is nothing to assess against, and showing such a row as
 * "not started" would put the blame on the wrong party (Appendix A —
 * "responsibility for a missed deadline falls on whoever controlled it").
 */
export function yearEndState(row: ParticipantStatusInput): StepState {
  if (row.goalSettingExempt) return "NOT_APPLICABLE";
  if (!row.goalsApprovedAt) return "NOT_APPLICABLE";
  if (row.yearEnd.employeeSignedAt && row.yearEnd.managerSignedAt) return "COMPLETE";
  if (row.selfRatedCount === 0) return "NOT_STARTED";
  if (row.selfRatedCount < row.kpiCount) return "IN_PROGRESS";
  if (row.managerRatedCount < row.kpiCount) return "AWAITING_MANAGER";
  if (!row.yearEnd.employeeSignedAt) return "AWAITING_EMPLOYEE";
  return "AWAITING_MANAGER";
}

/**
 * §5.4's verbatim statuses, for a stage that has LOCKED with a party still owing.
 *
 * The spec dictates these two strings ("Employee did not sign", "employee
 * signed, manager did not"), so they are returned as keys the UI renders rather
 * than assembled from parts — a paraphrase in a compliance record is a different
 * record.
 */
export function outstandingLabel(row: ParticipantStatusInput, stageLocked: boolean): string | null {
  if (!stageLocked || row.goalSettingExempt || row.goalsApprovedAt) return null;
  const { employeeSignedAt, managerSignedAt } = row.goalSetting;
  if (!managerSignedAt) return "managerDidNotSign";
  if (!employeeSignedAt) return "employeeDidNotSign";
  return null;
}

export function deriveStatus(
  row: ParticipantStatusInput,
  goalStageLocked: boolean,
): ParticipantStatus {
  return {
    ...row,
    goalSettingState: goalSettingState(row),
    yearEndState: yearEndState(row),
    weightageComplete: row.weightageTotal.equals(HUNDRED),
    outstandingLabel: outstandingLabel(row, goalStageLocked),
  };
}

export type StageTally = Record<StepState, number>;

export function emptyTally(): StageTally {
  return {
    NOT_APPLICABLE: 0,
    NOT_STARTED: 0,
    IN_PROGRESS: 0,
    AWAITING_EMPLOYEE: 0,
    AWAITING_MANAGER: 0,
    AWAITING_HR: 0,
    COMPLETE: 0,
  };
}

/**
 * Completion health, as §13.3's "rolled-up completion health" and §13.5's
 * "cycle-progress / completion tracking" both want it.
 *
 * NOT_APPLICABLE rows are excluded from the denominator, not counted as done: a
 * C-Level participant with no goal-setting step is neither complete nor
 * outstanding, and folding them into either number would misstate how much work
 * is actually left.
 */
export function completion(tally: StageTally): { done: number; total: number; percent: number } {
  const total =
    tally.NOT_STARTED +
    tally.IN_PROGRESS +
    tally.AWAITING_EMPLOYEE +
    tally.AWAITING_MANAGER +
    tally.AWAITING_HR +
    tally.COMPLETE;
  if (total === 0) return { done: 0, total: 0, percent: 0 };
  return {
    done: tally.COMPLETE,
    total,
    percent: Math.round((tally.COMPLETE / total) * 1000) / 10,
  };
}

export function tallyBy(
  rows: readonly ParticipantStatus[],
  pick: (row: ParticipantStatus) => StepState,
): StageTally {
  const tally = emptyTally();
  for (const row of rows) tally[pick(row)] += 1;
  return tally;
}

export type StageProgress = {
  stageKind: CycleStageKind;
  tally: StageTally;
  completion: ReturnType<typeof completion>;
};

export function stageProgress(rows: readonly ParticipantStatus[]): StageProgress[] {
  const goal = tallyBy(rows, (r) => r.goalSettingState);
  const year = tallyBy(rows, (r) => r.yearEndState);
  return [
    { stageKind: "GOAL_SETTING", tally: goal, completion: completion(goal) },
    { stageKind: "YEAR_END", tally: year, completion: completion(year) },
  ];
}

/** §13.3 — "what's outstanding": the rows a given manager still owes an action on. */
export function awaitingManager(rows: readonly ParticipantStatus[]): ParticipantStatus[] {
  return rows.filter(
    (r) => r.goalSettingState === "AWAITING_MANAGER" || r.yearEndState === "AWAITING_MANAGER",
  );
}
