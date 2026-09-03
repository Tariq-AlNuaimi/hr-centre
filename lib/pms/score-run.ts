import { Prisma } from "@/generated/prisma/client";
import type { Band, RoleTrack } from "@/generated/prisma/client";
import { bandFor, finalScore, individualScore, type ScoredKpi } from "./scoring";
import { DEFAULT_CYCLE_POLICY, type CyclePolicy } from "./cycle-policy";
import { proratedComponent, type PeriodWindow, type WeightedPeriodScore } from "./transfer";

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
  /**
   * §8.7's banding rule for THIS cycle. Optional, and absent means the
   * threshold reading this module has always used — so a caller that has not
   * loaded a policy scores exactly as before rather than throwing or silently
   * inverting at the 4.495 boundary (lib/pms/cycle-policy.ts).
   */
  policy?: Pick<CyclePolicy, "roundScoreBeforeBanding">;
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
  const policy = input.policy ?? DEFAULT_CYCLE_POLICY;

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
      band: bandFor(raw, policy),
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
    band: bandFor(raw, policy),
  };
}

/**
 * §12.3 — one period of a split year, with everything that period needs.
 *
 * Corporate and Departmental are per-period because §12.3 says so outright:
 * "Departmental and Corporate/entity scores follow the periods (old for the
 * first portion, new for the second)." A transfer between entities changes the
 * Corporate input, not just the Departmental one.
 */
export type PeriodInputs = PeriodWindow & {
  orderIndex: number;
  corporate: Prisma.Decimal | null;
  departmental: Prisma.Decimal | null;
  kpis: readonly ScoredKpi[];
};

export type SplitScoreInputs = {
  employeeId: string;
  roleTrack: RoleTrack;
  periods: readonly PeriodInputs[];
  threeSixty: Prisma.Decimal | null;
  /** §8.7's banding rule for this cycle — see the note on `ScoreInputs`. */
  policy?: Pick<CyclePolicy, "roundScoreBeforeBanding">;
};

/**
 * Score an employee whose year was split by a mid-cycle transfer.
 *
 * §12.3's formula, verbatim: "Prorated individual score = (Old-period KPI score
 * × old days/365) + (New-period KPI score × new days/365) — with
 * departmental/corporate components day-weighted the same way."
 *
 * So each component is day-weighted FIRST, and §8.6's track formula is then
 * applied once to the four weighted components. Applying the track formula per
 * period and then averaging would give the same answer for a linear formula and
 * a different one the moment §8.3's weights differ by track — and it would also
 * mean an employee who transferred BETWEEN tracks had two formulas applied,
 * which §12.3 says nothing about. One formula, weighted inputs.
 *
 * §9's 360 is NOT split: §12.3 — "360 is done once at year-end (from wherever
 * the employee sits then), not duplicated."
 *
 * A period whose manager has not assessed yet makes the whole employee
 * unscoreable, not half-scoreable — see `proratedComponent`.
 */
export function scoreSplitEmployee(input: SplitScoreInputs): ScoreOutcome {
  const { employeeId, roleTrack, periods, threeSixty } = input;
  const policy = input.policy ?? DEFAULT_CYCLE_POLICY;

  if (periods.length < 2) {
    return {
      scored: false,
      employeeId,
      reason: "A split year needs at least two periods (§12.3).",
    };
  }
  if (roleTrack === "C_LEVEL") {
    // §8.3 passes the entity score straight through, and §12.3's split is about
    // departmental KPIs. A C-Level transfer between entities is real but rare;
    // refusing it plainly beats inventing a weighting the spec does not give.
    return {
      scored: false,
      employeeId,
      reason: "C-Level scores pass through from the entity (§8.3) and are not split (§12.3).",
    };
  }

  const needsDepartmental = roleTrack !== "INDIVIDUAL";

  // Each period's own Individual score, from that period's KPI set. §5.3 applies
  // per period, so `individualScore` refuses a period that is not at 100%.
  const individualByPeriod: WeightedPeriodScore[] = [];
  for (const p of periods) {
    if (p.kpis.length === 0) {
      return {
        scored: false,
        employeeId,
        reason: `Period ${p.orderIndex + 1} has no KPIs — each department's manager drafts their own portion (§12.3).`,
      };
    }
    try {
      individualByPeriod.push({ ...p, score: individualScore(p.kpis) });
    } catch (error) {
      return {
        scored: false,
        employeeId,
        reason:
          error instanceof Error
            ? `Period ${p.orderIndex + 1}: ${error.message}`
            : `Period ${p.orderIndex + 1}'s KPI set cannot be scored.`,
      };
    }
  }

  const individual = proratedComponent(individualByPeriod);
  const corporate = proratedComponent(periods.map((p) => ({ ...p, score: p.corporate })));
  const departmental = needsDepartmental
    ? proratedComponent(periods.map((p) => ({ ...p, score: p.departmental })))
    : null;

  if (corporate === null) {
    return {
      scored: false,
      employeeId,
      reason: "A Corporate score is missing for at least one of this employee's periods (§12.3).",
    };
  }
  if (needsDepartmental && departmental === null) {
    return {
      scored: false,
      employeeId,
      reason:
        "A Departmental score is missing for at least one of this employee's periods (§12.3).",
    };
  }
  if (individual === null) {
    return { scored: false, employeeId, reason: "One period is not yet assessed (§12.3)." };
  }
  if (threeSixty === null) {
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
    band: bandFor(raw, policy),
  };
}
