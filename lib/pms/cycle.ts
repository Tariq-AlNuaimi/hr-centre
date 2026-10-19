import type { CycleStageKind, RoleTrack } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isHr, type PmsActor } from "./permissions";

/**
 * The performance cycle — spec §2 (cadence) and §5.4 (hard locks).
 *
 * Every "may this person act on this stage right now?" question in Phase 2 funnels
 * through `stageState` and `canActOnStage`, for the same reason §4's questions
 * funnel through permissions.ts: a lock that is re-derived at each call site is a
 * lock that eventually disagrees with itself.
 *
 * Time is always passed in, never read from the clock inside these functions.
 * A deadline system whose behaviour cannot be tested at an arbitrary instant is a
 * deadline system that only gets tested on the day it fires.
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
 */
export function graceEndsAt(stage: StageWindow): Date {
  return new Date(stage.deadline.getTime() + stage.graceDays * 24 * 60 * 60 * 1000);
}

/** True once HR's formal intervention is due (§5.5 rung three). */
export function isPastGrace(stage: StageWindow, now: Date): boolean {
  return now > graceEndsAt(stage);
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

/**
 * §4.1 — HR Super Admin ("everything + overrides") and HRBP ("Runs the cycle
 * org-wide (approvals, 360 setup, deadlines, escalations)") both run cycles.
 *
 * Deliberately NOT `capabilities.configure`, which §4.1 gives to Super Admin
 * alone: configuring the org (entities, departments) and running the year are
 * different authorities, and HRBP has the second without the first.
 */
export function canRunCycle(actor: PmsActor): boolean {
  return isHr(actor);
}

/**
 * Enrol every active employee into a cycle. Idempotent.
 *
 * §3.5 — "New rows → create the employee, pull them into the cycle." Rather than
 * a special joiner path that the import has to remember to call, enrolment is
 * re-runnable and simply adds whoever is missing. Running it after an import is
 * therefore the same operation as running it when the cycle opened.
 *
 * LEAVERs are not enrolled: §12.1 says their pending actions close out and no
 * "lingering Overdue" should pollute the compliance record. An employee who
 * leaves mid-cycle keeps the participant row they already had — this only
 * governs who gets added.
 */
export async function enrolParticipants(
  cycleId: string,
  options?: { limit?: number },
): Promise<{ added: number; remaining: number }> {
  const [employees, existing] = await Promise.all([
    prisma.employee.findMany({ where: { status: "ACTIVE" }, select: { id: true } }),
    prisma.cycleParticipant.findMany({ where: { cycleId }, select: { employeeId: true } }),
  ]);

  const enrolled = new Set(existing.map((p) => p.employeeId));
  const missing = employees.filter((e) => !enrolled.has(e.id));
  if (missing.length === 0) return { added: 0, remaining: 0 };

  // `limit` exists because this is now reachable from a REQUEST, not only from
  // the one-off cycle-open click. Each row is its own audited create, so a
  // thousand joiners is a thousand round trips, and a route that runs out of
  // time mid-way returns nothing useful to the person waiting on it. Bounding
  // it turns that into visible, resumable progress: the caller is told what is
  // left and the same idempotent call finishes the job.
  const batch = options?.limit === undefined ? missing : missing.slice(0, options.limit);

  // One row at a time rather than createMany: the audit extension records a
  // per-row CREATE, and `no-unaudited-bulk-write` exists to stop exactly the
  // shortcut that would leave enrolment invisible in the audit trail.
  for (const employee of batch) {
    await prisma.cycleParticipant.create({
      data: { cycleId, employeeId: employee.id },
      select: { id: true },
    });
  }
  return { added: batch.length, remaining: missing.length - batch.length };
}
