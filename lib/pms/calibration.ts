import { Prisma } from "@/generated/prisma/client";
import type { Band } from "@/generated/prisma/client";
import { isHrSuperAdmin, type PmsActor } from "./permissions";

/**
 * §10 — the calibration layer.
 *
 * "Calibration is a separate layer that never overwrites the raw score. Every
 * employee always retains both a raw calculated score and a calibrated score,
 * with full auditability." (§10.1)
 *
 * Nothing here writes. The one thing this module refuses to express is a
 * function that changes a raw score — there isn't one, and that absence is the
 * §10.1 guarantee made structural rather than promised in a comment.
 */

/** §8.7's bands, best to worst — the order a distribution is read in. */
export const BANDS: readonly Band[] = [
  "OUTSTANDING",
  "EXCELLENT",
  "TARGET",
  "ALMOST_ACHIEVED",
  "UNSATISFACTORY",
];

export type Distribution = Record<Band, number>;

/** An empty tally, so every band appears even at zero — a band with nobody in
 *  it is a fact HR needs to see, not a row to omit. */
export function emptyDistribution(): Distribution {
  return {
    OUTSTANDING: 0,
    EXCELLENT: 0,
    TARGET: 0,
    ALMOST_ACHIEVED: 0,
    UNSATISFACTORY: 0,
  };
}

export function tally(bands: readonly Band[]): Distribution {
  const out = emptyDistribution();
  for (const b of bands) out[b] += 1;
  return out;
}

/**
 * §10.4 — "the system shows HR the target distribution vs. actual raw
 * distribution, highlights the gap, and HR moves individuals using judgment. It
 * does not mathematically force people into bands."
 *
 * So this returns the GAP, per band, and nothing else. There is deliberately no
 * function that computes "who should move" — that is the judgment §10.4 reserves
 * for a person, and offering a suggested list is how guided calibration quietly
 * becomes forced calibration.
 */
export function distributionGap(params: {
  actual: Distribution;
  targetPct: Distribution;
  headcount: number;
}): {
  band: Band;
  actualCount: number;
  actualPct: string;
  targetPct: string;
  deltaCount: string;
}[] {
  const { actual, targetPct, headcount } = params;
  const total = new Prisma.Decimal(headcount);

  return BANDS.map((band) => {
    const count = new Prisma.Decimal(actual[band]);
    const target = new Prisma.Decimal(targetPct[band]);
    const targetCount = total.times(target).div(100);
    return {
      band,
      actualCount: actual[band],
      actualPct: headcount === 0 ? "0.00" : count.div(total).times(100).toFixed(2),
      targetPct: target.toFixed(2),
      // Positive means MORE people are in this band than the target implies.
      deltaCount: count.minus(targetCount).toFixed(2),
    };
  });
}

/**
 * §10.3 — "Applied per department, but only to departments with ≥ 5 active
 * employees in the cycle. … Sub-5 departments: keep their raw scores as final
 * (no forced shape); HR manual-override still available."
 *
 * Note the second half: a small department is exempt from the CURVE, not from
 * override. `adjustmentBlockedReason` therefore does not consult this at all —
 * §10.5 says manual override is available "on every department (curved or not)".
 */
export function isCurveEligible(activeCount: number, minDepartmentSize: number): boolean {
  return activeCount >= minDepartmentSize;
}

export type CalibrationRefusal = { reason: string; status: 403 | 404 | 409 };

/**
 * §10.5 / §10.6 — why a calibration adjustment cannot be made, or null.
 *
 * §10.6 is unusually specific: "Only HR Super Admin performs calibration
 * adjustments and overrides (and defines the target distribution). **HRBP does
 * not touch calibration.**" That is the one place in the spec where the two HR
 * roles diverge on an action rather than on a report, so it is checked against
 * `isHrSuperAdmin` and not `isHr`.
 */
export function adjustmentBlockedReason(params: {
  actor: PmsActor;
  fromBand: Band;
  toBand: Band;
  reason: string | null;
  published: boolean;
}): CalibrationRefusal | null {
  const { actor, fromBand, toBand, reason, published } = params;

  if (!isHrSuperAdmin(actor)) {
    return {
      reason: "Only an HR Super Admin calibrates — HRBP does not touch calibration.",
      status: 403,
    };
  }
  if (fromBand === toBand) {
    return { reason: "That is the band they are already in.", status: 409 };
  }
  if (reason === null || reason.trim() === "") {
    // §10.5 — mandatory. The database refuses a blank too.
    return {
      reason: "A calibration adjustment carries a mandatory reason.",
      status: 409,
    };
  }
  if (published) {
    // §13.2 — results are live to employees. Moving a band underneath someone
    // who has already read it is a correction that has to be deliberate: HR
    // un-publishes first, which is itself audited.
    return {
      reason:
        "Results for this cycle are published. Un-publish before adjusting, so the " +
        "correction is deliberate and recorded.",
      status: 409,
    };
  }
  return null;
}

/**
 * §10.7's gate — why calibration may not be considered complete, or null.
 *
 * "No calibration until all raw scores are in. No release until calibration is
 * done." The first half is what this answers; the second is the publish gate's
 * job (§13.2), which asks this question before it fires.
 */
export function calibrationReadinessBlockedReason(params: {
  participantCount: number;
  scoredCount: number;
  hasTarget: boolean;
}): string | null {
  const { participantCount, scoredCount, hasTarget } = params;

  if (participantCount === 0) return "No one is enrolled in this cycle.";
  if (scoredCount === 0) {
    return "No raw scores have been calculated yet — §10.7 puts the score run before calibration.";
  }
  if (scoredCount < participantCount) {
    return (
      `${scoredCount} of ${participantCount} participants have a raw score. §10.7 is explicit: ` +
      `no calibration until all raw scores are in.`
    );
  }
  if (!hasTarget) {
    return "No target distribution has been defined for this cycle.";
  }
  return null;
}
