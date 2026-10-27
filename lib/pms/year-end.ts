import type { SignOffParty } from "@/generated/prisma/client";
import { canActOnEmployee, isHr, type PmsActor } from "./permissions";
import { canActOnStage, type StageWindow } from "./cycle";
import type { RatingRefusal } from "./rating";

/**
 * §7.1's second half — where the year-end assessment STANDS, and who may sign it.
 *
 * Split from `rating.ts` because §7.1 itself separates the two acts: recording a
 * rating is one person's judgement about one KPI, signing is both parties'
 * agreement to the whole set. Phase 2 draws the same line between `kpi.ts`
 * (drafting) and `signoff.ts` (signing), and for the same reason — the
 * preconditions are different and the actors are different.
 */

export type RatingRow = { kpiId: string; party: SignOffParty; level: number };

/** Where a participant's year-end assessment stands — what the screens render. */
export type YearEndState = {
  kpiCount: number;
  employeeRated: number;
  managerRated: number;
  /** Every KPI carries both ratings — §7.1's precondition for signing. */
  complete: boolean;
  /** KPI ids where the two parties chose different levels. */
  divergentKpiIds: string[];
};

export function yearEndState(
  kpis: readonly { id: string }[],
  ratings: readonly RatingRow[],
): YearEndState {
  const byKpi = new Map<string, { EMPLOYEE?: number; MANAGER?: number }>();
  for (const kpi of kpis) byKpi.set(kpi.id, {});
  for (const rating of ratings) {
    const entry = byKpi.get(rating.kpiId);
    // A rating whose KPI has since been withdrawn is ignored rather than
    // counted: it cannot be signed against something that is not in the set.
    if (entry) entry[rating.party] = rating.level;
  }

  let employeeRated = 0;
  let managerRated = 0;
  const divergentKpiIds: string[] = [];
  for (const [kpiId, entry] of byKpi) {
    if (entry.EMPLOYEE !== undefined) employeeRated += 1;
    if (entry.MANAGER !== undefined) managerRated += 1;
    if (
      entry.EMPLOYEE !== undefined &&
      entry.MANAGER !== undefined &&
      entry.EMPLOYEE !== entry.MANAGER
    ) {
      divergentKpiIds.push(kpiId);
    }
  }

  return {
    kpiCount: byKpi.size,
    employeeRated,
    managerRated,
    // An EMPTY set is not complete. Otherwise a participant with no KPIs would
    // be signable at year-end, producing a signed assessment of nothing.
    complete: byKpi.size > 0 && employeeRated === byKpi.size && managerRated === byKpi.size,
    divergentKpiIds,
  };
}

/**
 * §7.1 — why this party may not SIGN the year-end assessment yet, or null.
 *
 * Unlike §5.3's exactly-100 rule at goal-setting, the precondition here is
 * completeness: both parties have rated every KPI. Signing a half-rated
 * assessment would sign agreement to ratings that do not exist.
 */
export function yearEndSignBlockedReason(params: {
  state: YearEndState;
  stage: StageWindow | null;
  now: Date;
}): string | null {
  const { state, stage, now } = params;

  if (stage === null) return "This cycle has no year-end stage configured yet.";
  if (!canActOnStage(stage, now)) {
    return now < stage.opensAt
      ? "The year-end review has not opened yet for this cycle."
      : "The year-end deadline has passed and the stage is locked.";
  }
  if (state.kpiCount === 0) {
    return "This participant has no KPIs, so there is no year-end assessment to sign.";
  }
  if (state.employeeRated < state.kpiCount) {
    return (
      `The employee has self-assessed ${state.employeeRated} of ${state.kpiCount} KPIs. ` +
      `§7.1 signs the final ratings, so every KPI needs one first.`
    );
  }
  if (state.managerRated < state.kpiCount) {
    return (
      `The manager has reviewed ${state.managerRated} of ${state.kpiCount} KPIs. ` +
      `§7.1 signs the final ratings, so every KPI needs one first.`
    );
  }
  return null;
}

/**
 * §7.1's two signatures, as a predicate over who may sign as which party.
 *
 * §7.2 — the manager of record is whoever holds the relationship AT THE MOMENT
 * of the action, resolved live from `Employee.managerId`, never snapshotted. A
 * manager who inherits a report in November signs their year-end.
 */
export function yearEndSignerBlockedReason(params: {
  actor: PmsActor;
  party: SignOffParty;
  subject: { id: string; managerId: string | null };
}): RatingRefusal | null {
  const { actor, party, subject } = params;

  if (party === "EMPLOYEE") {
    if (actor.employeeId === null || actor.employeeId !== subject.id) {
      return { reason: "Participant not found", status: 404 };
    }
    return null;
  }

  if (!canActOnEmployee(actor, subject)) {
    return { reason: "Participant not found", status: 404 };
  }
  // HR may act org-wide (§4.1), but a signature is a statement of agreement by a
  // named person — so HR signing "as the manager" is refused. §5.5 gives HR a
  // way past a stuck signature (extend, intervene, mark non-compliant), and that
  // is the path, not impersonation.
  if (isHr(actor) && actor.employeeId !== subject.managerId) {
    return {
      reason:
        "A year-end signature is the line manager's own statement of agreement. HR can " +
        "extend the deadline or record a non-compliance, but cannot sign in their place.",
      status: 403,
    };
  }
  return null;
}
