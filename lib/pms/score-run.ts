import { Prisma } from "@/generated/prisma/client";
import type { Band, RoleTrack, SignOffParty } from "@/generated/prisma/client";
import { bandFor, finalScore, individualScore, type ScoredKpi } from "./scoring";
import { DEFAULT_CYCLE_POLICY, type CyclePolicy } from "./cycle-policy";
import {
  periodDays,
  proratedComponent,
  type PeriodWindow,
  type WeightedPeriodScore,
} from "./transfer";

/**
 * §8's wiring — turning captured inputs into one stored score per employee.
 *
 * The arithmetic lives in `scoring.ts` (tested against the spec's worked
 * examples). This module answers the question that comes first: **can this
 * employee be scored at all**, and if not, why — because §10.7 will not let
 * calibration start until every participant has a raw score, so "why is this one
 * missing" is the question HR will actually be asking.
 */

/**
 * One KPI as the score run receives it.
 *
 * `level` is NULLABLE, and that is the point. The route used to filter unrated
 * KPIs out before scoring, which left the weightages short of 100 and made
 * `individualScore` report "§5.3: weightages total 70%, not 100" — sending HR to
 * the goal-setting baseline when the real cause was a manager who had not
 * finished reviewing. A missing rating has to survive as far as the code that
 * explains it.
 *
 * `description` is carried for the same reason: a count is not actionable, and
 * "starting with “Quality”" tells HR which conversation to have.
 */
type RatedKpi = {
  description: string;
  /** §7.1's MANAGER rating — the assessed result. Null when not yet rated. */
  level: number | null;
  weightage: Prisma.Decimal | string | number;
};

/**
 * §10.7 — why this assessment is not ready to score, naming the party.
 *
 * The signatures are a PRECONDITION, not a formality: §10.7 sequences the score
 * run after "assessments completed & signed". Before this existed, scoring read
 * ratings and never looked at a signature, so an employee nobody had signed off
 * was scored, calibrated and published — with correct arithmetic, which is
 * exactly why nothing surfaced it.
 */
function signatureBlockedReason(signedParties: readonly SignOffParty[]): string | null {
  const missing = (["EMPLOYEE", "MANAGER"] as const).filter((p) => !signedParties.includes(p));
  if (missing.length === 0) return null;
  const who = missing.map((p) => (p === "EMPLOYEE" ? "the employee" : "the manager"));
  return (
    `${who.join(" and ")} ${missing.length === 1 ? "has" : "have"} not signed the year-end ` +
    `assessment. §10.7 puts the score run after “assessments completed & signed”.`
  );
}

/** §7.1 — KPIs the manager has not rated yet, named rather than counted away. */
function unratedBlockedReason(kpis: readonly RatedKpi[]): string | null {
  const unrated = kpis.filter((k) => k.level === null);
  if (unrated.length === 0) return null;
  return (
    `${unrated.length} of ${kpis.length} KPIs have not been rated by the manager yet — ` +
    `starting with “${unrated[0].description}”. §7.1 makes the manager's review the ` +
    `assessed result, so there is nothing to score until it is complete.`
  );
}

/** Every level is present once `unratedBlockedReason` has returned null. */
const asScored = (kpis: readonly RatedKpi[]): ScoredKpi[] =>
  kpis.map((k) => ({ level: k.level as number, weightage: k.weightage }));

export type ScoreInputs = {
  employeeId: string;
  roleTrack: RoleTrack;
  /** §8.4 — the entity's Corporate score. Null when HR has not keyed it. */
  corporate: Prisma.Decimal | null;
  /** §8.4 — the department's score. Null when unkeyed OR when the track has none. */
  departmental: Prisma.Decimal | null;
  /** §7.1's ratings for this employee's KPIs, including the unrated ones. */
  kpis: readonly RatedKpi[];
  /**
   * §10.7 — the year-end sign-offs that exist for this participant.
   *
   * Required, not optional. An optional field here would be an opt-out of the
   * precondition, and a caller that forgot it would silently score unsigned
   * assessments again — the exact defect this closes.
   */
  signedParties: readonly SignOffParty[];
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
 * QA2 N-01 — the ranges `employee_scores_ranges_check` enforces, checked BEFORE
 * the write, per employee.
 *
 * The database is the last line, not the first: when it was the only check, one
 * out-of-range participant (a §12.3 split year clamped to a few days of service)
 * threw inside the run, the route answered 500 with an empty body, and HR could
 * not tell who or why. Here it becomes one skipped row with a reason, and the
 * other 300 are scored.
 */
/**
 * QA2 N-01 — the "latest run" every reader means: a FINISHED one. The score run
 * is now one transaction, so an unfinished run can only be debris from before
 * that; reading it as the latest made calibration count rows the panel did not.
 */
export const completedRunWhere = (cycleId: string) => ({
  cycleId,
  finishedAt: { not: null },
});

type ScoreComponents = {
  corporate: Prisma.Decimal;
  departmental: Prisma.Decimal | null;
  individual: Prisma.Decimal;
  threeSixty: Prisma.Decimal | null;
  raw: Prisma.Decimal;
};

const fmt = (v: Prisma.Decimal) => v.toDecimalPlaces(2).toString();

export function scoreRangeProblem(c: ScoreComponents): string | null {
  const scale = (label: string, v: Prisma.Decimal | null, min: number) =>
    v !== null && (v.lessThan(min) || v.greaterThan(5))
      ? `The ${label} is ${fmt(v)}, outside the ${min === 0 ? "0–5" : "1–5"} scale.`
      : null;
  return (
    scale("Corporate score", c.corporate, 1) ??
    scale("Departmental score", c.departmental, 1) ??
    scale("Individual score", c.individual, 1) ??
    scale("360 score", c.threeSixty, 0) ??
    scale("final score", c.raw, 1)
  );
}

/**
 * The last step both paths share: apply §8.6, band it, and refuse anything the
 * database would refuse — as a per-person reason rather than an exception.
 */
function finish(
  employeeId: string,
  roleTrack: RoleTrack,
  parts: Omit<ScoreComponents, "raw">,
  policy: Pick<CyclePolicy, "roundScoreBeforeBanding">,
  context = "",
): ScoreOutcome {
  let raw: Prisma.Decimal;
  try {
    raw = finalScore(roleTrack, {
      corporate: parts.corporate,
      departmental: parts.departmental,
      individual: parts.individual,
      threeSixty: parts.threeSixty ?? parts.corporate,
    });
  } catch (error) {
    return {
      scored: false,
      employeeId,
      reason: error instanceof Error ? error.message : "These inputs cannot be scored.",
    };
  }
  const problem = scoreRangeProblem({ ...parts, raw });
  if (problem) {
    return {
      scored: false,
      employeeId,
      reason: `${problem}${context} Correct the input, then run the calculation again.`,
    };
  }
  return { scored: true, employeeId, ...parts, raw, band: bandFor(raw, policy) };
}

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

  const noCorporate = {
    scored: false as const,
    employeeId,
    // §8.4 — every employee receives their entity's Corporate score, so a
    // missing one blocks the whole entity, not just this person.
    reason: "No Corporate score has been keyed for this employee's entity.",
  };

  if (roleTrack === "C_LEVEL") {
    // §8.3 — no formula, and no assessment either, so the entity score is the
    // only input they have and the only one worth reporting.
    if (corporate === null) return noCorporate;
    // §8.3 — the entity score IS the final score. Recorded in the individual
    // column too so §13.5's export shows a complete row rather than a blank
    // that reads like missing data.
    return finish(
      employeeId,
      "C_LEVEL",
      { corporate, departmental: null, individual: corporate, threeSixty: null },
      policy,
    );
  }

  // SIGNATURES FIRST — before the Corporate score, and the order is deliberate.
  //
  // §10.7 sequences "assessments completed & signed" ahead of the score run, and
  // the per-person blocker is the one a person can act on: a missing Corporate
  // score is one keystroke for the whole entity, and while it was checked first
  // it MASKED every unsigned assessment behind it. An HR user looking at the
  // skipped list would have seen 300 identical "no Corporate score" rows and
  // learned nothing about the 40 people who had not signed.
  //
  // C-Level never reach here: §8.3 excuses them from self-assessment entirely,
  // so they have no signatures to wait for.
  const unsigned = signatureBlockedReason(input.signedParties);
  if (unsigned) return { scored: false, employeeId, reason: unsigned };

  if (corporate === null) return noCorporate;

  const needsDepartmental = roleTrack !== "INDIVIDUAL";
  if (needsDepartmental && departmental === null) {
    return {
      scored: false,
      employeeId,
      reason: `No Departmental score has been keyed for this employee's department.`,
    };
  }

  if (kpis.length === 0) {
    return {
      scored: false,
      employeeId,
      reason: "This employee has no KPIs to score (§5.2 — the baseline was never drafted).",
    };
  }

  // Before §5.3's arithmetic, so a missing rating is reported as a missing
  // rating. In practice the signature check above catches most of these — a
  // sign-off already requires every KPI rated — but this is the one that
  // explains an HR intervention or a set changed after signing (§6.2).
  const unrated = unratedBlockedReason(kpis);
  if (unrated) return { scored: false, employeeId, reason: unrated };

  let individual: Prisma.Decimal;
  try {
    individual = individualScore(asScored(kpis));
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
      reason: "This employee has no completed 360 assessment.",
    };
  }

  return finish(
    employeeId,
    roleTrack,
    { corporate, departmental: needsDepartmental ? departmental : null, individual, threeSixty },
    policy,
  );
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
  kpis: readonly RatedKpi[];
};

export type SplitScoreInputs = {
  employeeId: string;
  roleTrack: RoleTrack;
  periods: readonly PeriodInputs[];
  threeSixty: Prisma.Decimal | null;
  /** §10.7 — as on `ScoreInputs`. A split year is still one assessment to sign. */
  signedParties: readonly SignOffParty[];
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
      reason: "A split year needs at least two periods.",
    };
  }
  if (roleTrack === "C_LEVEL") {
    // §8.3 passes the entity score straight through, and §12.3's split is about
    // departmental KPIs. A C-Level transfer between entities is real but rare;
    // refusing it plainly beats inventing a weighting the spec does not give.
    return {
      scored: false,
      employeeId,
      reason: "C-Level scores pass through from the entity and are not split.",
    };
  }

  // §10.7 — a transfer does not excuse the signatures. One assessment, one
  // pair of sign-offs, however many departments paid for the year.
  const unsignedSplit = signatureBlockedReason(input.signedParties);
  if (unsignedSplit) return { scored: false, employeeId, reason: unsignedSplit };

  const needsDepartmental = roleTrack !== "INDIVIDUAL";

  // QA2 N-01 — periods are clamped to actual service before they are weighted,
  // so a pre-joiner (or anyone whose dates fall outside the cycle) can arrive
  // here with no service days at all. Every component would be 0 — not a score.
  const serviceDays = periods.reduce((sum, p) => sum + periodDays(p), 0);
  if (serviceDays === 0) {
    return {
      scored: false,
      employeeId,
      reason:
        "This employee has no days of service inside this cycle's split periods (§12.3) — " +
        "check their joining and leaving dates, or remove them from the cycle.",
    };
  }

  // Each period's own Individual score, from that period's KPI set. §5.3 applies
  // per period, so `individualScore` refuses a period that is not at 100%.
  const individualByPeriod: WeightedPeriodScore[] = [];
  for (const p of periods) {
    if (p.kpis.length === 0) {
      return {
        scored: false,
        employeeId,
        reason: `Period ${p.orderIndex + 1} has no KPIs — each department's manager drafts their own portion.`,
      };
    }
    const unratedPeriod = unratedBlockedReason(p.kpis);
    if (unratedPeriod) {
      return {
        scored: false,
        employeeId,
        reason: `Period ${p.orderIndex + 1}: ${unratedPeriod}`,
      };
    }
    try {
      individualByPeriod.push({ ...p, score: individualScore(asScored(p.kpis)) });
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
      reason: "A Corporate score is missing for at least one of this employee's periods.",
    };
  }
  if (needsDepartmental && departmental === null) {
    return {
      scored: false,
      employeeId,
      reason: "A Departmental score is missing for at least one of this employee's periods.",
    };
  }
  if (individual === null) {
    return { scored: false, employeeId, reason: "One period is not yet assessed." };
  }
  if (threeSixty === null) {
    return {
      scored: false,
      employeeId,
      reason: "This employee has no completed 360 assessment.",
    };
  }

  // §12.3 weights by days ÷ 365, so a short year scales the components down.
  // Below about 3 months of service that leaves them under the 1–5 scale, which
  // no band, calibration or bonus reads; the person is named for HR instead.
  return finish(
    employeeId,
    roleTrack,
    { corporate, departmental: needsDepartmental ? departmental : null, individual, threeSixty },
    policy,
    ` The split periods cover ${serviceDays} days of service (weighted by days ÷ 365, §12.3).`,
  );
}
