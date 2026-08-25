import type { GoalStage } from "@/components/pms/StageBanner";
import type { ParticipantRow } from "@/components/pms/ParticipantList";

/**
 * §4.4's "My Tasks" — which rows are waiting on ME, and in what order.
 *
 * Pure, and here rather than in the component for two reasons. It crossed the
 * complexity budget inside `MyTasksOversight.tsx`, and splitting by cohesion
 * beat waiving — but the better reason is that "whose turn is it, and how late"
 * is exactly the logic a screenshot cannot check and a test can.
 *
 * §4.4 is emphatic that this space is "driven by assignment, not hierarchy or
 * role name", so every decision below keys on `employee.id === me` or
 * `employee.managerId === me`. A role never appears.
 */

export const DUE_SOON_MS = 3 * 24 * 60 * 60 * 1000;

export type TaskTone = "overdue" | "dueSoon" | "notYetOpen" | "open";

export interface Task {
  key: string;
  titleKey: string;
  titleParams?: Record<string, string>;
  detailKey: string;
  actionKey: string;
  href: string;
  /** Lower sorts first. Stage urgency dominates; task kind breaks the tie. */
  rank: number;
  /** The server's own sentence for why this set cannot be edited, if it cannot. */
  blockedReason: string | null;
}

/**
 * The clock, as a subscription rather than a render-time read.
 *
 * `Date.now()` during render is impure, and would make the server and client
 * renders disagree. §5.4's LOCK never depends on it — `stage.state` is the
 * SERVER's answer, so a slow client clock can never invent or hide a lock. The
 * only thing this decides is the softer "due soon" band, which is also why it
 * ticks: a screen left open overnight should cross that boundary rather than
 * keep yesterday's answer.
 */
export const CLOCK_TICK_MS = 60_000;

export function toneForStage(stage: GoalStage | null, nowMs: number | null): TaskTone {
  if (!stage) return "notYetOpen";
  if (stage.state === "LOCKED") return "overdue";
  if (stage.state === "NOT_YET_OPEN") return "notYetOpen";
  if (nowMs !== null && new Date(stage.deadline).getTime() - nowMs <= DUE_SOON_MS) {
    return "dueSoon";
  }
  return "open";
}

export const STAGE_RANK: Record<TaskTone, number> = {
  overdue: 0,
  dueSoon: 1,
  open: 2,
  notYetOpen: 3,
};

/**
 * Order WITHIN one stage band — by how much of someone else's work this card is
 * holding up, with the card nobody can act on last.
 *
 * A "My Tasks" list is read top-down and acted on top-down, so the first row has
 * to be the one worth doing first. Drafting for a report blocks that person
 * entirely and outranks signing, which is one click; my own set ranks below both
 * because only I am waiting on it; and "your manager has not drafted yours yet"
 * is not a task at all — it is context, so it sits at the bottom rather than
 * leading a list of things to do.
 */
const KIND_RANK = {
  reportNotDrafted: 0,
  reportPartlyDrafted: 1,
  reportAwaitingMySignature: 2,
  ownSignable: 3,
  ownWaitingOnManager: 4,
} as const;

/** Stage urgency dominates; `KIND_RANK` only ever breaks a tie inside a band. */
const STAGE_BAND = 10;

/** My own goal-setting step, if it is still waiting on me (§5.1). */
export function ownTask(row: ParticipantRow, href: string, stageRank: number): Task | null {
  if (row.signOff.employeeSignedAt) return null;
  // §5.3 — a set can only be signed at exactly 100%. Until it is there the ball
  // is with the manager, so the card says so instead of offering a button the
  // route would refuse.
  const signable = row.weightageComplete;
  return {
    key: `own-${row.participantId}`,
    titleKey: "ownSetTitle",
    detailKey: signable ? "ownSetSign" : "ownSetWaiting",
    actionKey: signable ? "ownSetAction" : "ownSetView",
    href,
    rank:
      stageRank * STAGE_BAND + (signable ? KIND_RANK.ownSignable : KIND_RANK.ownWaitingOnManager),
    blockedReason: null,
  };
}

/** A direct report's set, if it still needs drafting or my signature (§4.2, §5.1). */
export function reportTask(row: ParticipantRow, href: string, stageRank: number): Task | null {
  const needsDrafting = !row.weightageComplete;
  const needsSignature = row.weightageComplete && !row.signOff.managerSignedAt;
  if (!needsDrafting && !needsSignature) return null;
  const detailKey = needsDrafting
    ? row.kpiCount === 0
      ? "reportDraftEmpty"
      : "reportDraft"
    : "reportSign";
  return {
    key: `report-${row.participantId}`,
    titleKey: "reportDraftTitle",
    titleParams: { name: row.employee.name },
    detailKey,
    actionKey: "reportAction",
    href,
    rank:
      stageRank * STAGE_BAND +
      (row.kpiCount === 0
        ? KIND_RANK.reportNotDrafted
        : needsDrafting
          ? KIND_RANK.reportPartlyDrafted
          : KIND_RANK.reportAwaitingMySignature),
    blockedReason: row.editBlockedReason,
  };
}

export function buildTasks(params: {
  rows: ParticipantRow[];
  employeeId: string | null;
  stageRank: number;
  hrefFor: (row: ParticipantRow) => string;
  locale: string;
}): Task[] {
  const { rows, employeeId, stageRank, hrefFor, locale } = params;
  // §4.4 keys entirely on assignment, so an actor with no employee row has no
  // tasks by definition — answered once rather than per row.
  if (employeeId === null) return [];

  const tasks: Task[] = [];
  for (const row of rows) {
    // §8.3 — a C-Level participant has no goal-setting step, so no task exists.
    if (row.goalSettingExempt) continue;
    const href = hrefFor(row);
    const own = row.employee.id === employeeId ? ownTask(row, href, stageRank) : null;
    if (own) tasks.push(own);
    const report = row.employee.managerId === employeeId ? reportTask(row, href, stageRank) : null;
    if (report) tasks.push(report);
  }
  return tasks.sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key, locale));
}
