import { Prisma } from "@/generated/prisma/client";
import type { Band, RoleTrack } from "@/generated/prisma/client";
import { bandFor, finalScore, individualScore, type ScoredKpi } from "./scoring";

/**
 * §8's wiring — turning captured inputs into one stored score per employee.
 *
 * The arithmetic lives in `scoring.ts` (tested against the spec's worked
 * examples). This module answers the question that comes first: **can this
 * employee be scored at all**, and if not, why — because §10.7 will not let
 * calibration start until every participant has a raw score, so "why is this one
 * missing" is the question HR will actually be asking.
 */

export type ScoreInputs = {
  employeeId: string;
  roleTrack: RoleTrack;
  /** §8.4 — the entity's Corporate score. Null when HR has not keyed it. */
  corporate: Prisma.Decimal | null;
  /** §8.4 — the department's score. Null when unkeyed OR when the track has none. */
  departmental: Prisma.Decimal | null;
  /** §7.1's ratings for this employee's KPIs. */
  kpis: readonly ScoredKpi[];
  /** §8.5's 1–5 equivalent of the 360 ratio. Null when the 360 produced none. */
  threeSixty: Prisma.Decimal | null;
};

export type ScoreOutcome =
  | {
      scored: true;
      employeeId: string;
      corporate: Prisma.Decimal;
      departmental: Prisma.Decimal | null;
      individual: Prisma.Decimal;
      threeSixty: Prisma.Decimal | null;
      raw: Prisma.Decimal;
      band: Band;
    }
  | { scored: false; employeeId: string; reason: string };

/**
 * Score one employee, or say why not.
 *
 * §8.3's C-Level path comes first and is genuinely different: "no formula. Final
 * Score = the entity's Corporate KPI score, passed straight through." They have
 * no KPIs, no self-assessment and no 360, so asking for any of those would
 * refuse to score the very people the spec says are simplest.
 */
export function scoreEmployee(input: ScoreInputs): ScoreOutcome {
  const { employeeId, roleTrack, corporate, departmental, kpis, threeSixty } = input;

  if (corporate === null) {
    // §8.4 — every employee receives their entity's Corporate score, so a
    // missing one blocks the whole entity, not just this person.
    return {
      scored: false,
      employeeId,
      reason: "No Corporate score has been keyed for this employee's entity (§8.4).",
    };
  }

  if (roleTrack === "C_LEVEL") {
    const raw = finalScore("C_LEVEL", {
      corporate,
      departmental: null,
      individual: corporate,
      threeSixty: corporate,
    });
    return {
      scored: true,
      employeeId,
      corporate,
      departmental: null,
      // §8.3 — the entity score IS the final score. Recorded in the individual
      // column too so §13.5's export shows a complete row rather than a blank
      // that reads like missing data.
      individual: corporate,
      threeSixty: null,
      raw,
      band: bandFor(raw),
    };
  }

  const needsDepartmental = roleTrack !== "INDIVIDUAL";
  if (needsDepartmental && departmental === null) {
    return {
      scored: false,
      employeeId,
      reason: `No Departmental score has been keyed for this employee's department (§8.4).`,
    };
  }

  if (kpis.length === 0) {
    return {
      scored: false,
      employeeId,
      reason: "This employee has no KPIs to score (§5.2 — the baseline was never drafted).",
    };
  }

  let individual: Prisma.Decimal;
  try {
    individual = individualScore(kpis);
  } catch (error) {
    // §5.3's exactly-100 rule, or an out-of-range level. Reported per employee
    // rather than aborting the run: one broken set must not stop the other 300.
    return {
      scored: false,
      employeeId,
      reason: error instanceof Error ? error.message : "This KPI set cannot be scored.",
    };
  }

  if (threeSixty === null) {
    // §8.3 gives every non-C-Level track a 360 weight, so a missing 360 makes
    // the final score unrepresentable rather than merely lower.
    return {
      scored: false,
      employeeId,
      reason: "This employee has no completed 360 assessment (§9.5, §8.5).",
    };
  }

  const raw = finalScore(roleTrack, {
    corporate,
    departmental: needsDepartmental ? departmental : null,
    individual,
    threeSixty,
  });

  return {
    scored: true,
    employeeId,
    corporate,
    departmental: needsDepartmental ? departmental : null,
    individual,
    threeSixty,
    raw,
    band: bandFor(raw),
  };
}
