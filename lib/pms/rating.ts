import type { CycleStageKind, RoleTrack, SignOffParty } from "@/generated/prisma/client";
import { canActOnEmployee, type PmsActor } from "./permissions";
import { canActOnStage, isGoalSettingExempt, type StageWindow } from "./cycle";
import { DEFAULT_CYCLE_POLICY, type CyclePolicy } from "./cycle-policy";

/**
 * §7.1 — the year-end assessment.
 *
 * "The employee self-assesses against each KPI using the five-level descriptors
 * defined at goal-setting → the manager reviews → discussion happens offline →
 * both sign off on the final ratings."
 *
 * That sentence fixes an ORDER, and this module is where the order is enforced:
 * the manager cannot review a KPI the employee has not assessed, and neither
 * party can sign until every KPI carries both ratings.
 *
 * ## Two rules the spec does not state, decided by the operator
 *
 * 1. **The manager SEES the self-assessment while reviewing.** §7.1's word is
 *    "reviews", which most naturally means reviewing what the employee
 *    submitted. The known cost is anchoring — the manager's rating drifting
 *    toward the employee's — and the alternative (blind until both are in) would
 *    have invented a step §7 does not describe. Recorded rather than assumed;
 *    see the blueprint's Phase 3b decisions.
 * 2. **A divergent manager rating requires a written reason.** A downgrade with
 *    nothing said is the thing employees dispute and §10's calibration cannot
 *    interpret months later. This ADDS a rule to the spec and is flagged to
 *    Rihal alongside the §6 re-sign question.
 *
 * `divergenceBlockedReason` below is that second rule, and it is a CROSS-ROW
 * condition — it compares the manager's level against the employee's — so it
 * cannot be a CHECK constraint. It lives here, called by the route, which is why
 * this file exists rather than the rule being inlined once.
 */

/** §2's year-end touchpoint. Ratings and their signatures both hang off it. */
export const YEAR_END_STAGE: CycleStageKind = "YEAR_END";

/** §8.1's scale, in the order the spec lists it, with the descriptor it names. */
export const RATING_LEVELS = [
  { level: 5, field: "descriptorOutstanding" },
  { level: 4, field: "descriptorExcellent" },
  { level: 3, field: "descriptorTarget" },
  { level: 2, field: "descriptorAlmostAchieved" },
  { level: 1, field: "descriptorUnsatisfactory" },
] as const;

export type RatingLevelField = (typeof RATING_LEVELS)[number]["field"];

/** True for a level §8.1 recognises. Anything else is not a rating. */
export function isRatingLevel(level: number): boolean {
  return Number.isInteger(level) && level >= 1 && level <= 5;
}

export type RatingRefusal = { reason: string; status: 403 | 404 | 409 };

/**
 * Who may record a rating as `party`, and when.
 *
 * §7.1's order is the load-bearing part: the EMPLOYEE goes first. A manager who
 * could rate an unassessed KPI would turn "reviews" into "rates on their behalf",
 * and the employee's own view of their year would never be recorded at all.
 *
 * 404 rather than 403 for an actor with no relationship to the employee — the
 * same existence-oracle rule the rest of the system uses (§4.2).
 */
export function ratingBlockedReason(params: {
  actor: PmsActor;
  party: SignOffParty;
  subject: { id: string; managerId: string | null; roleTrack: RoleTrack };
  stage: StageWindow | null;
  now: Date;
  goalsApprovedAt: Date | null;
  /** Whether the employee has already self-assessed THIS KPI (§7.1's order). */
  employeeRated: boolean;
}): RatingRefusal | null {
  const { actor, party, subject, stage, now, goalsApprovedAt, employeeRated } = params;

  // §8.3 — C-Level skip goal-setting, self-assessment and 360 entirely. There is
  // no KPI set of theirs to rate, so the refusal is categorical.
  if (isGoalSettingExempt(subject.roleTrack)) {
    return {
      reason:
        "C-Level employees skip self-assessment entirely (§8.3) — their score passes through " +
        "from the entity.",
      status: 409,
    };
  }

  if (party === "EMPLOYEE") {
    // Only the employee assesses themselves. Not the manager "on their behalf",
    // and not HR: §7.1 gives this action to one person.
    if (actor.employeeId === null || actor.employeeId !== subject.id) {
      return { reason: "Participant not found", status: 404 };
    }
  } else {
    // §4.2 — the DIRECT line manager reviews, with §4.1's HR override.
    if (!canActOnEmployee(actor, subject)) {
      return { reason: "Participant not found", status: 404 };
    }
    if (!employeeRated) {
      return {
        reason:
          "This KPI has not been self-assessed yet. §7.1 puts the employee's assessment first — " +
          "the manager reviews it.",
        status: 409,
      };
    }
  }

  // §5.1 — there is nothing to rate against without an agreed baseline.
  if (goalsApprovedAt === null) {
    return {
      reason:
        "This KPI set has no HR-approved baseline, so there is nothing to assess against (§5.1).",
      status: 409,
    };
  }

  if (stage === null) {
    return { reason: "This cycle has no year-end stage configured yet (§2).", status: 409 };
  }
  if (!canActOnStage(stage, now)) {
    return {
      reason:
        now < stage.opensAt
          ? "The year-end review has not opened yet for this cycle (§2)."
          : "The year-end deadline has passed and the stage is locked (§5.4).",
      status: 409,
    };
  }
  return null;
}

/**
 * The operator's divergence rule: a manager who rates differently from the
 * employee must say why.
 *
 * Returns null when the rating needs no comment, when one was given, or when
 * this cycle's policy does not require one (§7.1 is genuinely ambiguous here —
 * see lib/pms/cycle-policy.ts).
 * Deliberately silent about the EMPLOYEE's rating — a self-assessment has
 * nothing to diverge from, and requiring a justification for one's own view of
 * one's own year is a different (and worse) rule.
 */
export function divergenceBlockedReason(params: {
  party: SignOffParty;
  level: number;
  employeeLevel: number | null;
  comment: string | null;
  policy?: Pick<CyclePolicy, "divergenceReason">;
}): string | null {
  const { party, level, employeeLevel, comment } = params;
  const { divergenceReason } = params.policy ?? DEFAULT_CYCLE_POLICY;
  // §7.1 puts the disagreement conversation OFFLINE, so a system that records
  // it is an addition to the spec — which is why how hard it insists is Rihal's
  // call, per cycle, and not the build's. OPTIONAL and OFF both let the save
  // through; the difference between them lives in the UI, which prompts under
  // OPTIONAL and says nothing under OFF. Blocking is the only behaviour a route
  // can express, so this function knows about REQUIRED and nothing else.
  if (divergenceReason !== "REQUIRED") return null;
  if (party !== "MANAGER") return null;
  if (employeeLevel === null || employeeLevel === level) return null;
  if (comment !== null && comment.trim() !== "") return null;

  const direction = level < employeeLevel ? "lower" : "higher";
  return (
    `Your rating (${level}) is ${direction} than the employee's self-assessment ` +
    `(${employeeLevel}). Say why — the reason is shown to them and is what calibration reads ` +
    `later (§7.1, §10).`
  );
}
