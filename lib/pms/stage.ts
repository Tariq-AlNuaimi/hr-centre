import type { CycleStageKind, RoleTrack } from "@/generated/prisma/client";
import {
  DEFAULT_CALENDAR,
  addWorkingDays,
  utcDate,
  type WorkingCalendar,
} from "@/lib/working-time/calendar";

/**
 * §2's cadence and §5.4's locks — the PURE half, with no database import.
 *
 * Split out of `lib/pms/cycle.ts` for a reason worth stating, because the
 * symptom was far from the cause: `cycle.ts` imports `prisma` at module scope
 * for `enrolParticipants`, so ANY value imported from it drags the Postgres
 * driver along. When §7.1's evidence rules started asking `canActOnStage`, and
 * a client component imports those rules for its size and type constants, the
 * whole chain — evidence → cycle → prisma → pg → `dns` — was pulled into the
 * BROWSER bundle. The build failed on a missing `dns` module, seven layers from
 * anything to do with dates.
 *
 * So the rules a client may legitimately need live here, where there is nothing
 * to drag. `cycle.ts` re-exports every one of them, so no existing caller
 * changes and there is still one definition of each.
 *
 * Time is always passed in, never read from the clock inside these functions.
 * A deadline system whose behaviour cannot be tested at an arbitrary instant is
 * a deadline system that only gets tested on the day it fires.
 */

/** §2's three touchpoints, in the order the year runs them. */
export const STAGE_ORDER: readonly CycleStageKind[] = [
  "GOAL_SETTING",
  "MID_YEAR",
  "YEAR_END",
] as const;

/**
 * §8.3 — "C-Level skip goal-setting, self-assessment, and 360 entirely; they
 * exist in the system for record-keeping/reporting."
 *
 * They are still enrolled as participants: §11's reporting and the entity
 * score pass-through both need the row. What they are exempt from is the WORK.
 */
export function isGoalSettingExempt(roleTrack: RoleTrack): boolean {
  return roleTrack === "C_LEVEL";
}

export type StageWindow = {
  kind: CycleStageKind;
  opensAt: Date;
  deadline: Date;
  graceDays: number;
};

/**
 * Where a stage sits relative to an instant.
 *
 * `LOCKED` is deliberately the same answer for "the deadline passed five minutes
 * ago" and "it passed in March": §5.4 says "after a deadline passes, the relevant
 * party can no longer act on that stage", with no taper. The grace window does
 * NOT extend the ability to act — see `graceEndsAt` below.
 */
export type StageState = "NOT_YET_OPEN" | "OPEN" | "LOCKED";

export function stageState(stage: StageWindow, now: Date): StageState {
  if (now < stage.opensAt) return "NOT_YET_OPEN";
  // Exactly at the deadline is still open; one millisecond past is not. A
  // deadline of "31 December" means the whole of the 31st when HR sets the time
  // to 23:59, which is a UI concern — this comparison stays exact.
  if (now > stage.deadline) return "LOCKED";
  return "OPEN";
}

/**
 * §5.4's hard lock, as one predicate.
 *
 * There is no actor parameter and that is the point: the lock is a property of
 * time, identical for a line manager, an employee and an HR Super Admin. §5.5
 * gives HR a way past a missed deadline — extend it — and that changes the
 * DEADLINE, leaving an audit trail, rather than letting HR quietly act inside a
 * locked stage.
 */
export function canActOnStage(stage: StageWindow, now: Date): boolean {
  return stageState(stage, now) === "OPEN";
}

/**
 * §5.5's third rung: when HR's formal intervention becomes due.
 *
 * The grace window runs from the DEADLINE, not from the escalation — skip-level
 * and HR are notified the moment the deadline passes (rung two), and this is how
 * long the ladder waits before HR is expected to extend, intervene, or mark a
 * formal non-compliance event.
 *
 * P2-9 / ADR-077 — grace is counted in WORKING days on the one core calendar
 * (`lib/working-time`: the working week and public holidays), so three days of
 * grace over a weekend or Eid is three days HR can actually act on. The
 * deadline's time of day is kept: a 23:59:59 deadline ends its grace at 23:59:59.
 * Callers that run in production pass the loaded calendar; the default is the
 * Sun–Thu Asia/Muscat schedule with no holidays.
 */
export function graceEndsAt(
  stage: StageWindow,
  calendar: WorkingCalendar = DEFAULT_CALENDAR,
): Date {
  if (stage.graceDays <= 0) return stage.deadline;
  const day = utcDate(stage.deadline);
  const timeOfDay = stage.deadline.getTime() - day.getTime();
  return new Date(addWorkingDays(day, stage.graceDays, calendar).getTime() + timeOfDay);
}

/** True once HR's formal intervention is due (§5.5 rung three). */
export function isPastGrace(
  stage: StageWindow,
  now: Date,
  calendar: WorkingCalendar = DEFAULT_CALENDAR,
): boolean {
  return now > graceEndsAt(stage, calendar);
}

/**
 * How overdue a stage is, in whole hours — §5.6's "by how long".
 *
 * Floored rather than rounded: a compliance record that says a manager was two
 * hours late when they were one hour and fifty-nine minutes late is a record
 * someone can argue with, and the entire point of §5.6 is that the report is
 * objective.
 */
export function hoursOverdue(stage: StageWindow, now: Date): number {
  const ms = now.getTime() - stage.deadline.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / (60 * 60 * 1000));
}
