import { prisma } from "@/lib/prisma";
import { participantStatuses } from "@/lib/pms/status-query";
import { completion, tallyBy, type StepState } from "@/lib/pms/status";
import { stageState } from "@/lib/pms/stage";
import { persistNotifications, type PendingNotification } from "@/lib/core/notify/store";
import type { CycleStageKind } from "@/generated/prisma/client";

/**
 * A cycle's console (UX review perf-jml P1-8, docs/blueprints/ux-p1-performance.md):
 * the stage timeline, completion and LATE counts per stage, and a setup
 * checklist — HR's one place to see "where is this year" (Lattice's progress
 * tab). Org-wide, so callers gate on `canRunCycle`. Reuses the status engine
 * the roster reads, so the numbers agree with it.
 */

const SETTLED: ReadonlySet<StepState> = new Set(["COMPLETE", "NOT_APPLICABLE"]);
const STATE_OF: Partial<Record<CycleStageKind, "goalSettingState" | "yearEndState">> = {
  GOAL_SETTING: "goalSettingState",
  YEAR_END: "yearEndState",
};

export async function cycleOverview(cycleId: string, now: Date = new Date()) {
  const cycle = await prisma.performanceCycle.findUnique({
    where: { id: cycleId },
    select: {
      id: true,
      year: true,
      status: true,
      stages: {
        orderBy: { opensAt: "asc" },
        select: { kind: true, opensAt: true, deadline: true, graceDays: true },
      },
    },
  });
  if (!cycle) return null;
  const goal = cycle.stages.find((s) => s.kind === "GOAL_SETTING");
  const [{ rows, truncated }, entityScores, departmentScores, targets] = await Promise.all([
    participantStatuses({
      cycleId,
      scope: null,
      goalStageLocked: goal ? stageState(goal, now) === "LOCKED" : false,
      includeScores: false,
    }),
    prisma.entityScore.count({ where: { cycleId } }),
    prisma.departmentScore.count({ where: { cycleId } }),
    prisma.calibrationTarget.count({ where: { cycleId } }),
  ]);

  const stages = cycle.stages.map((s) => {
    const field = STATE_OF[s.kind];
    const state = stageState(s, now);
    const tally = field ? tallyBy(rows, (r) => r[field]) : null;
    const pastDeadline = s.deadline.getTime() < now.getTime();
    const late = field && pastDeadline ? rows.filter((r) => !SETTLED.has(r[field])).length : 0;
    return {
      kind: s.kind,
      opensAt: s.opensAt,
      deadline: s.deadline,
      graceDays: s.graceDays,
      state,
      completion: tally ? completion(tally) : null,
      late,
    };
  });

  return {
    cycle: { id: cycle.id, year: cycle.year, status: cycle.status },
    participants: rows.length,
    truncated,
    stages,
    setup: [
      { key: "stages", done: cycle.stages.length >= 3 },
      { key: "enrolled", done: rows.length > 0 },
      { key: "scores", done: entityScores + departmentScores > 0 },
      { key: "calibration", done: targets > 0 },
    ],
  };
}

/** Who owes the next step at a stage, by the participant's state there. Pure. */
export function owedBy(
  state: StepState,
  row: { employeeId: string; managerId: string | null },
): string | null {
  if (state === "AWAITING_EMPLOYEE") return row.employeeId;
  if (state === "NOT_STARTED" || state === "IN_PROGRESS" || state === "AWAITING_MANAGER")
    return row.managerId;
  return null; // AWAITING_HR is HR's own queue; settled states owe nothing.
}

/**
 * "Remind late" (P1-8): one in-app reminder to each person who owes a step at
 * a stage whose deadline has passed — at most one per person, stage and day
 * (the dedupe key carries the date), bounded by the same writer the nightly
 * sweep uses.
 */
export async function remindLate(cycleId: string, kind: CycleStageKind, now: Date = new Date()) {
  const field = STATE_OF[kind];
  if (!field) return { reminded: 0 };
  const overview = await cycleOverview(cycleId, now);
  const stage = overview?.stages.find((s) => s.kind === kind);
  if (!overview || !stage || stage.deadline.getTime() >= now.getTime()) return { reminded: 0 };
  // Reminding only after a deadline: goal setting (the earlier stage) is locked by then.
  const { rows } = await participantStatuses({
    cycleId,
    scope: null,
    goalStageLocked: true,
    includeScores: false,
  });
  const day = now.toISOString().slice(0, 10);
  const recipients = new Map<string, number>();
  for (const r of rows) {
    const who = owedBy(r[field], r);
    if (who) recipients.set(who, (recipients.get(who) ?? 0) + 1);
  }
  const href = kind === "GOAL_SETTING" ? "/goal-setting" : "/year-end";
  const pending: PendingNotification[] = [...recipients].map(([employeeId, count]) => ({
    recipientEmployeeId: employeeId,
    kind: "CYCLE_REMINDER",
    body: `${count} ${kind === "GOAL_SETTING" ? "goal-setting" : "year-end"} ${count === 1 ? "step is" : "steps are"} past the deadline for the ${overview.cycle.year} cycle and waiting on you.`,
    href,
    dedupeKey: `remind-late:${cycleId}:${kind}:${employeeId}:${day}`,
  }));
  const result = await persistNotifications(pending, 500);
  return { reminded: result.written };
}
