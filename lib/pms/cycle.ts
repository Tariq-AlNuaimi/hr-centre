import { prisma } from "@/lib/prisma";
import { isHr, type PmsActor } from "@/lib/core/permissions";

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

/**
 * §2/§5.4's pure rules live in `./stage` (no prisma import, so a client
 * component can reach them). Re-exported here because this module was their
 * home and every existing caller imports them from it — one definition, two
 * doors.
 */
export {
  STAGE_ORDER,
  isGoalSettingExempt,
  stageState,
  canActOnStage,
  graceEndsAt,
  isPastGrace,
  hoursOverdue,
  type StageWindow,
} from "./stage";

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
/**
 * Which participants COUNT towards a cycle's completion — §10.7's denominator.
 *
 * The gates used to ask `cycleParticipant.count({ where: { cycleId } })` with no
 * filter of any kind, and that is a deadlock with no exit: a participant whose
 * employee record was soft-deleted as an erroneous import can never be scored
 * (they have no ratings, no 360) and can never be removed from the denominator,
 * so `scoredCount < participantCount` holds forever and calibration and publish
 * refuse for the rest of time. An operator hit exactly that after an import of
 * test employees, and found that marking them LEAVER did not help — because
 * LEAVER revokes a login and touches nothing here.
 *
 * Soft-deleted employees are excluded. `docs/rules/prisma.md` and the recycling
 * bin are explicit that an `Employee` soft delete is "for ERRONEOUS records
 * only — a departure is `status = LEAVER`", so a soft-deleted row is a record
 * that should never have existed, and counting a non-person's unfinished
 * assessment against the cycle is not a rule anybody wants.
 *
 * LEAVERs are deliberately NOT excluded. §12.1 preserves their record and
 * §11.4 pro-rates their bonus to their last working day, so somebody who left
 * in October has a real year to be scored on. Dropping them from the
 * denominator would quietly discard that; the right instrument for a leaver who
 * genuinely should not be scored is a deliberate, audited exclusion, which does
 * not exist yet and should not be invented by inference here.
 *
 * ONE definition, used by the count AND by the score run's own iteration. If
 * they disagreed, `scoredCount` could exceed `participantCount` and the gate
 * would read as complete while someone was still unscored.
 */
export function countableParticipantWhere(cycleId: string): {
  cycleId: string;
  employee: { deletedAt: null };
} {
  return { cycleId, employee: { deletedAt: null } };
}

/** Postgres unique-violation, as Prisma reports it. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

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

  // `limit` exists because every caller is a REQUEST with a clock on it —
  // including the cycle-open transition, which this comment previously implied
  // was something else. Each row is its own audited create, so a
  // thousand joiners is a thousand round trips, and a route that runs out of
  // time mid-way returns nothing useful to the person waiting on it. Bounding
  // it turns that into visible, resumable progress: the caller is told what is
  // left and the same idempotent call finishes the job.
  const batch = options?.limit === undefined ? missing : missing.slice(0, options.limit);

  // One row at a time rather than createMany: the audit extension records a
  // per-row CREATE, and `no-unaudited-bulk-write` exists to stop exactly the
  // shortcut that would leave enrolment invisible in the audit trail.
  let added = 0;
  for (const employee of batch) {
    try {
      await prisma.cycleParticipant.create({
        data: { cycleId, employeeId: employee.id },
        select: { id: true },
      });
      added += 1;
    } catch (error) {
      // `missing` is a snapshot, and two writers can hold the same one: the
      // import enrolling while HR presses the button, one HR user in two tabs,
      // two HR users at once. `@@unique([cycleId, employeeId])` then refuses
      // the second write — which is the right outcome, and not an error. The
      // person is enrolled; that is all anyone asked for. Only a unique
      // violation is swallowed, so a real failure still surfaces.
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return { added, remaining: missing.length - batch.length };
}
