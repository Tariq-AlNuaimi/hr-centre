import { Prisma } from "@/generated/prisma/client";
import { DEFAULT_CYCLE_POLICY, type CyclePolicy } from "./cycle-policy";
import type { RoleTrack } from "@/generated/prisma/client";

/**
 * §8 — the scoring model.
 *
 * Pure arithmetic over values other phases capture: §7.1's ratings, the
 * Strategy team's Corporate and Departmental scores (§8.4), and the 360 ratio
 * (§9.5). Nothing here reads the database or decides who may see a result —
 * §13.2's publish gate is a separate act, and this module computes numbers that
 * are not shown to anyone until it happens.
 *
 * ## Everything is Decimal, not float
 *
 * §8.7 maps a score onto a band at exact boundaries (4.50, 4.00, 3.00, 2.00),
 * and §8.2 sums products of a rating and a percentage. In IEEE-754,
 * `3 * 0.05 + 4 * 0.20 + …` drifts, and a score that should sit exactly on 4.50
 * lands at 4.499999999999999 — which is a different band, a different bonus
 * coefficient (§11.3), and a different answer to the employee. Decimal makes the
 * boundary mean what the table says.
 */

/** §8.1 — every component resolves onto this scale. */
const MIN_LEVEL = 1;
const MAX_LEVEL = 5;

export type Band = "OUTSTANDING" | "EXCELLENT" | "TARGET" | "ALMOST_ACHIEVED" | "UNSATISFACTORY";

/**
 * §8.3 — the weight each component carries, by role track.
 *
 * `null` means the component does not apply: §8.3 gives Individuals no
 * Departmental component at all, which is different from a zero weight. A zero
 * would quietly accept a departmental score and multiply it away; null refuses
 * one, so a mis-keyed Strategy figure cannot silently vanish into an
 * Individual's result.
 *
 * C_LEVEL has no row on purpose — §8.3: "C-Level: no formula. Final Score = the
 * entity's Corporate KPI score, passed straight through." `finalScore` handles
 * them before any weighting happens.
 */
export const TRACK_WEIGHTS: Record<
  Exclude<RoleTrack, "C_LEVEL">,
  { corporate: number; departmental: number | null; individual: number; threeSixty: number }
> = {
  DIRECTOR: { corporate: 30, departmental: 40, individual: 10, threeSixty: 20 },
  MANAGER: { corporate: 20, departmental: 50, individual: 10, threeSixty: 20 },
  LEAD: { corporate: 10, departmental: 60, individual: 10, threeSixty: 20 },
  INDIVIDUAL: { corporate: 10, departmental: null, individual: 80, threeSixty: 10 },
};

const d = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v);
const HUNDRED = d(100);

export type ScoredKpi = {
  /** §8.1's level, 1–5. */
  level: number;
  /** §5.3's percentage. Decimal or its string form — never a float. */
  weightage: Prisma.Decimal | string | number;
};

/**
 * §8.2 — "For each KPI: Rating × Weightage = Weighted KPI Score. The Individual
 * KPI bucket score = sum of all weighted KPI scores."
 *
 * The spec's own worked example: Target(3) × 5% = 0.15, Excellent(4) × 20% =
 * 0.80. So the weightage is applied as a FRACTION, and because §5.3 forces the
 * weightages to total exactly 100, the sum lands back on the 1–5 scale.
 *
 * Throws when the set does not total 100. That is not defensiveness: §5.3 makes
 * exactly-100 an invariant of every signed set, so a set that fails it here has
 * been corrupted after sign-off, and scoring it would produce a number on no
 * scale at all — silently, and in the direction of whoever's weightages went
 * missing.
 */
export function individualScore(kpis: readonly ScoredKpi[]): Prisma.Decimal {
  if (kpis.length === 0) {
    throw new RangeError("§8.2: an empty KPI set has no Individual score");
  }
  let total = d(0);
  let weightTotal = d(0);
  for (const kpi of kpis) {
    if (!Number.isInteger(kpi.level) || kpi.level < MIN_LEVEL || kpi.level > MAX_LEVEL) {
      throw new RangeError(`§8.1: ${kpi.level} is not a level; ratings are 1–5`);
    }
    const weightage = d(kpi.weightage);
    weightTotal = weightTotal.plus(weightage);
    total = total.plus(weightage.div(HUNDRED).times(kpi.level));
  }
  if (!weightTotal.equals(HUNDRED)) {
    throw new RangeError(
      `§5.3: weightages total ${weightTotal}%, not 100 — this set cannot be scored`,
    );
  }
  return total;
}

/**
 * §8.5 — "The 360 result is carried into the final formula as its 1–5
 * equivalent: the averaged ratio × 5."
 *
 * The spec's example: 0.92 → 4.60.
 */
export function threeSixtyAsLevel(ratio: Prisma.Decimal | string | number): Prisma.Decimal {
  const r = d(ratio);
  if (r.lessThan(0) || r.greaterThan(1)) {
    throw new RangeError(`§9.5: a 360 ratio is between 0 and 1; got ${r}`);
  }
  return r.times(5);
}

export type Components = {
  /** §8.4 — the entity's Corporate score, on the 1–5 scale. */
  corporate: Prisma.Decimal | string | number;
  /** §8.4 — the department's score. Null for Individuals, who have none. */
  departmental: Prisma.Decimal | string | number | null;
  /** §8.2's bucket score. */
  individual: Prisma.Decimal | string | number;
  /** §8.5's 1–5 equivalent, NOT the raw ratio. */
  threeSixty: Prisma.Decimal | string | number;
};

/**
 * §8.6 — "Final Score = (Corporate × w) + (Departmental × w) + (Individual × w)
 * + (360(1–5) × w)".
 *
 * C-Level (§8.3) never reach the formula: their final score IS the entity's
 * Corporate score. Handled first, because running them through a weighting they
 * have no row for would be the kind of silent zero this module exists to avoid.
 */
export function finalScore(roleTrack: RoleTrack, components: Components): Prisma.Decimal {
  if (roleTrack === "C_LEVEL") {
    // §8.3 — "no formula … passed straight through".
    return d(components.corporate);
  }

  const w = TRACK_WEIGHTS[roleTrack];

  // §8.3 gives Individuals no Departmental component. A score supplied for one
  // is a keying error upstream, and multiplying it by a zero weight would hide
  // that rather than surface it.
  if (w.departmental === null && components.departmental !== null) {
    throw new RangeError(
      `§8.3: the ${roleTrack} track has no Departmental component, but one was supplied`,
    );
  }
  if (w.departmental !== null && components.departmental === null) {
    throw new RangeError(`§8.3: the ${roleTrack} track requires a Departmental score`);
  }

  const part = (value: Prisma.Decimal | string | number, weight: number) =>
    d(value).times(d(weight).div(HUNDRED));

  let total = part(components.corporate, w.corporate)
    .plus(part(components.individual, w.individual))
    .plus(part(components.threeSixty, w.threeSixty));

  if (w.departmental !== null && components.departmental !== null) {
    total = total.plus(part(components.departmental, w.departmental));
  }
  return total;
}

/**
 * §8.7 — the band a final score falls in.
 *
 * The spec's table names closed ranges (4.50–5.00, 4.00–4.49, …) which leave a
 * gap between 4.49 and 4.50. Read literally, 4.495 belongs to no band. The
 * boundaries are therefore implemented as `>=` thresholds, which is the only
 * reading under which every score in 1–5 maps somewhere, and which agrees with
 * the table at every value the table actually lists.
 *
 * **Now Rihal's to decide**, per cycle. `roundScoreBeforeBanding` selects the
 * other reading: round to 2dp first, and 4.495 becomes 4.50 and Outstanding —
 * the opposite answer from the same number. The parameter defaults to the
 * threshold reading, so a caller that does not pass a policy behaves exactly as
 * this function always has (see lib/pms/cycle-policy.ts).
 */
export function bandFor(
  score: Prisma.Decimal | string | number,
  policy: Pick<CyclePolicy, "roundScoreBeforeBanding"> = DEFAULT_CYCLE_POLICY,
): Band {
  // §8.7's second reading, and it is not cosmetic: at this boundary it is the
  // difference between a 2.0x and a 1.5x bonus coefficient on basic salary
  // (§11.3). Rounding HALF UP, because that is what "rounded to two decimals"
  // means to the HR reader deciding it — Decimal.js defaults to half-up too,
  // but the constant is named so the choice is on the page rather than in a
  // library's defaults.
  const s = policy.roundScoreBeforeBanding
    ? d(score).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : d(score);
  if (s.greaterThanOrEqualTo(d("4.50"))) return "OUTSTANDING";
  if (s.greaterThanOrEqualTo(d("4.00"))) return "EXCELLENT";
  if (s.greaterThanOrEqualTo(d("3.00"))) return "TARGET";
  if (s.greaterThanOrEqualTo(d("2.00"))) return "ALMOST_ACHIEVED";
  return "UNSATISFACTORY";
}

/**
 * §11.3 — the bonus coefficient a band earns.
 *
 * Kept here beside `bandFor` because it is a property OF the band, but note
 * §11.3's constraint that it is applied to the **calibrated** band, never the
 * raw one. Nothing in this module knows which it has been handed; the caller
 * that runs §10's calibration owns that distinction.
 */
export const BAND_COEFFICIENT: Record<Band, number> = {
  OUTSTANDING: 2.0,
  EXCELLENT: 1.5,
  TARGET: 1.0,
  ALMOST_ACHIEVED: 0,
  UNSATISFACTORY: 0,
};

/**
 * §8.7's table read the other way — the score range each band covers.
 *
 * `max` is the top of the band as a score can express it (4.49, not 4.50), which
 * is why the table is written with two-decimal literals rather than computed
 * from the next boundary: §8.7 prints those numbers, and a derived 4.4999…
 * would round into the band above.
 */
export const BAND_RANGE: Record<Band, { min: string; max: string }> = {
  OUTSTANDING: { min: "4.50", max: "5.00" },
  EXCELLENT: { min: "4.00", max: "4.49" },
  TARGET: { min: "3.00", max: "3.99" },
  ALMOST_ACHIEVED: { min: "2.00", max: "2.99" },
  UNSATISFACTORY: { min: "0.00", max: "1.99" },
};

/**
 * The score to SHOW alongside a calibrated band — §13.1's "final band and score
 * (calibrated, but never labeled as such — just 'their score')".
 *
 * §10 moves BANDS, not scores: there is no stored calibrated score, and §10.1
 * forbids overwriting the raw one. Showing the raw score next to a moved band
 * would put a contradiction on the employee's scorecard and hand them exactly
 * the "sign of calibration" §13.1 forbids — a 3.80 labelled Excellent is a
 * visible adjustment to anyone who has seen §8.7's table.
 *
 * So the displayed score is the raw score CLAMPED into the band the employee
 * was actually placed in. When calibration did not move them — the common case
 * — the clamp is a no-op and they see their exact score. When it did, the two
 * halves of the scorecard agree, and the raw figure survives untouched in the
 * column §13.5's master export reads.
 */
export function displayScore(rawScore: Prisma.Decimal, band: Band): Prisma.Decimal {
  const range = BAND_RANGE[band];
  if (rawScore.lessThan(range.min)) return d(range.min);
  if (rawScore.greaterThan(range.max)) return d(range.max);
  return rawScore;
}
