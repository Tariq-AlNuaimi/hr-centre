import type { CompetencyBand } from "./scoring-rollup";

/**
 * Calibration math (ARCHITECTURE §7, Phase-7 blueprint). PURE: no I/O, no Prisma,
 * no env — every output is a function of its inputs, so the whole file is
 * exhaustively unit-testable (tests/contracts/calibration.test.ts). The service
 * (lib/services/calibration.ts) maps Prisma rows onto these plain shapes, calls
 * `buildCalibration`, and persists the report.
 *
 * The loop is ADVISORY (ARCHITECTURE §7): it surfaces whether predicted fit and
 * each competency actually tracked observed success, and SUGGESTS a band direction.
 * It NEVER auto-adjusts a band — a human approves a new RoleProfile version. Every
 * number here is plain arithmetic (a weighted success blend, Pearson correlation,
 * the 4/5ths selection-rate rule), kept inspectable on purpose: that is the
 * defensibility thesis (ARCHITECTURE §2/§7), so it is surfaced on /methodology.
 *
 * HONESTY: at Rihal's realistic sample sizes these are DIRECTIONAL signals, not
 * statistically significant validation (true criterion validity wants 30+ hires —
 * ARCHITECTURE §13). Everything is labelled with its sample size, and a role below
 * MIN_OUTCOMES_FOR_REPORT yields an honest insufficient-data state, never a chart.
 */

// Minimum recorded outcomes before a role version gets a report. Directional even
// then; true significance wants far more (ARCHITECTURE §13). Tunable.
export const MIN_OUTCOMES_FOR_REPORT = 8;

// Cap on the per-candidate scatter points kept in the persisted report (and echoed
// to the browser). The correlation r is computed over the FULL population; only the
// stored/plotted point array is down-sampled so a high-volume role can't grow the
// ProfileCalibration.metrics JSONB blob / RSC payload without bound (senior-review H-1).
export const MAX_SCATTER_POINTS = 500;

// How an observed outcome collapses to a 0..1 success signal. Retention is the
// strongest real-world signal, ratings the softest/most subjective — so weighted
// but not dominant. Single source of truth; reweight here to re-tune the loop.
export type SuccessWeights = { retained: number; probation: number; rating: number };
export const DEFAULT_SUCCESS_WEIGHTS: SuccessWeights = {
  retained: 0.4,
  probation: 0.3,
  rating: 0.3,
};

// ---- Inputs (plain shapes; the service maps Prisma rows onto these) ----

/** The observed post-hire signals recorded on an OutcomeRecord. */
export type OutcomeInput = {
  hired: boolean;
  probationPassed: boolean | null;
  rating6m: number | null; // 1..5
  rating12m: number | null; // 1..5
  retained: boolean | null;
};

/** One (computed result, recorded outcome) pair feeding the calibration. */
export type CalibrationPair = {
  /** Predicted fit-to-role, 0..100 (Result.fitScore). */
  fitScore: number;
  /** Per-competency score + band from the Result roll-up. */
  competencies: { name: string; score: number; band: CompetencyBand }[];
  outcome: OutcomeInput;
};

/** One candidate's selection facts for the adverse-impact / selection-rate monitor. */
export type SelectionInput = {
  /** The grouping dimension (role family / role profile title). */
  group: string;
  /** Was the candidate advanced (the selection event)? */
  selected: boolean;
  /** Did the candidate meet the role's overall fit band (all competencies PASS)? */
  passed: boolean;
};

// ---- Outputs (persisted as JSON on ProfileCalibration.metrics; validated by zod) ----

export type BandSuggestion = "hold" | "raise" | "lower" | "insufficient";

export type CompetencySignal = {
  name: string;
  /** Number of (success-scored) pairs this competency appeared in. */
  n: number;
  /** Pearson r of competency score vs observed success, in [-1, 1]. */
  r: number;
  /** Mean observed success among candidates who PASSed this competency's band (or null). */
  meanSuccessPass: number | null;
  /** Mean observed success among candidates BELOW this competency's band (or null). */
  meanSuccessBelow: number | null;
  /** meanSuccessPass − meanSuccessBelow when both exist, else null. */
  gap: number | null;
  /** ADVISORY direction (never auto-applied). See competencySignal for the rule. */
  suggestion: BandSuggestion;
};

export type FitSummary = {
  n: number;
  /** Pearson r of predicted fitScore vs observed success, in [-1, 1]. */
  r: number;
  /** Mean observed success across the hired, outcome-recorded candidates. */
  meanSuccess: number;
  /** Mean predicted fit across the same candidates. */
  meanFit: number;
  /** The (fit, success) points for the predicted-vs-observed scatter (no PII). */
  points: { fit: number; success: number }[];
};

export type SelectionRateRow = {
  group: string;
  total: number;
  selected: number;
  /** selected / total, in [0, 1]. */
  selectionRate: number;
  /** Share meeting the overall fit band, in [0, 1]. */
  passRate: number;
  /** True when selectionRate < 0.8 × the highest group's rate (4/5ths rule). */
  adverseFlag: boolean;
};

export type CalibrationReport = {
  sampleSize: number;
  fit: FitSummary;
  competencies: CompetencySignal[];
};

export type CalibrationOutcome =
  | { kind: "ok"; report: CalibrationReport }
  | { kind: "insufficient"; have: number; need: number };

// ---- Pure functions ----

/** Round to `dp` decimals (default 4) — keeps persisted JSON tidy + deterministic. */
function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/**
 * Collapse an observed outcome to a 0..1 success signal, or null when it can't be
 * scored (ARCHITECTURE §7). Predictive validity is asked of HIRED candidates only,
 * so a non-hired outcome returns null (excluded from the correlation — a non-hire
 * is not a performance datapoint, and must not be conflated with "hired and
 * failed"). Among hires, the score is a weight-normalized blend of whatever signals
 * are recorded (retained, probation passed, mean rating mapped 1..5 → 0..1); if a
 * hire has NO post-hire signal yet, returns null (insufficient).
 */
export function successScore(
  o: OutcomeInput,
  weights: SuccessWeights = DEFAULT_SUCCESS_WEIGHTS
): number | null {
  if (!o.hired) return null;

  const parts: { w: number; v: number }[] = [];
  if (o.retained !== null) parts.push({ w: weights.retained, v: o.retained ? 1 : 0 });
  if (o.probationPassed !== null)
    parts.push({ w: weights.probation, v: o.probationPassed ? 1 : 0 });

  const ratings = [o.rating6m, o.rating12m].filter((r): r is number => r !== null);
  if (ratings.length) {
    // Map a 1..5 rating to 0..1 ((r−1)/4), clamped so out-of-range data can't escape.
    const norm = mean(ratings.map((r) => Math.max(0, Math.min(1, (r - 1) / 4))));
    parts.push({ w: weights.rating, v: norm });
  }

  if (!parts.length) return null;
  const totalW = parts.reduce((a, p) => a + p.w, 0);
  if (totalW <= 0) return null;
  return round(parts.reduce((a, p) => a + p.w * p.v, 0) / totalW);
}

/**
 * Pearson correlation of paired (x, y), in [-1, 1]. Returns 0 for fewer than 2
 * pairs or zero variance in either axis (a flat axis has no defined correlation —
 * we report 0 rather than leaking NaN into the persisted JSON).
 */
export function pearson(pairs: { x: number; y: number }[]): number {
  const n = pairs.length;
  if (n < 2) return 0;
  const mx = mean(pairs.map((p) => p.x));
  const my = mean(pairs.map((p) => p.y));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of pairs) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return 0;
  return round(sxy / Math.sqrt(sxx * syy));
}

/**
 * Per-competency predictive signal over the success-scored pairs (ARCHITECTURE §7).
 * For each competency: the correlation of its score vs observed success, and the
 * mean success of candidates who PASSed vs were BELOW its band. The ADVISORY
 * suggestion (never auto-applied) is evaluated in PRECEDENCE order so that a genuine
 * score→success signal always outranks the "loosen the band" rule:
 *   - `hold`   — clear positive signal (r ≥ 0.3 AND gap ≥ 0.15): the band discriminates.
 *   - `raise`  — positive correlation (r ≥ 0.3) but a weak pass/below gap: more signal
 *                sits at higher scores, so tightening may sharpen selection.
 *   - `lower`  — NO positive correlation AND BELOW-band hires did about as well as
 *                PASS-band hires (gap ≤ 0.05): the threshold may be stricter than warranted.
 *   - `insufficient` — no clear signal, or one side of the band has no hires.
 * The pass/below comparison uses only the clear PASS vs BELOW bands — PARTIAL is
 * excluded as ambiguous — and if either side has no hires the gap is undefined and the
 * result is `insufficient`, deliberately conservative for small/degenerate samples
 * (a 2-point correlation is spurious). Thresholds are tunable constants; everything is
 * surfaced with n so a small sample reads as directional, not significant.
 */
export function competencySignal(pairs: CalibrationPair[]): CompetencySignal[] {
  const scored = pairs
    .map((p) => ({ p, success: successScore(p.outcome) }))
    .filter((x): x is { p: CalibrationPair; success: number } => x.success !== null);

  const names = [...new Set(scored.flatMap((x) => x.p.competencies.map((c) => c.name)))].sort();

  return names.map((name) => {
    const rows = scored
      .map((x) => ({ comp: x.p.competencies.find((c) => c.name === name), success: x.success }))
      .filter((r): r is { comp: { name: string; score: number; band: CompetencyBand }; success: number } => Boolean(r.comp));

    const r = pearson(rows.map((row) => ({ x: row.comp.score, y: row.success })));
    const passVals = rows.filter((row) => row.comp.band === "PASS").map((row) => row.success);
    const belowVals = rows.filter((row) => row.comp.band === "BELOW").map((row) => row.success);
    const meanSuccessPass = passVals.length ? round(mean(passVals)) : null;
    const meanSuccessBelow = belowVals.length ? round(mean(belowVals)) : null;
    const gap =
      meanSuccessPass !== null && meanSuccessBelow !== null
        ? round(meanSuccessPass - meanSuccessBelow)
        : null;

    // Precedence: a genuine positive correlation (hold/raise) is decided BEFORE the
    // gap-based "lower" rule, so a competency whose score discriminates well is never
    // advised to loosen its band just because the coarse PASS/BELOW split is narrow.
    let suggestion: BandSuggestion = "insufficient";
    if (gap !== null) {
      if (r >= 0.3 && gap >= 0.15) suggestion = "hold";
      else if (r >= 0.3) suggestion = "raise";
      else if (gap <= 0.05) suggestion = "lower";
      else suggestion = "insufficient";
    }

    return { name, n: rows.length, r, meanSuccessPass, meanSuccessBelow, gap, suggestion };
  });
}

/** Even, deterministic down-sample of `xs` to at most `cap` items (keeps spread). */
function sample<T>(xs: T[], cap: number): T[] {
  if (xs.length <= cap) return xs;
  const step = xs.length / cap;
  const out: T[] = [];
  for (let i = 0; i < cap; i++) out.push(xs[Math.floor(i * step)]);
  return out;
}

/** Overall predicted-fit vs observed-success summary, with the scatter points. */
export function fitSummary(pairs: CalibrationPair[]): FitSummary {
  const points = pairs
    .map((p) => ({ fit: p.fitScore, success: successScore(p.outcome) }))
    .filter((pt): pt is { fit: number; success: number } => pt.success !== null);
  return {
    n: points.length,
    // r + means are computed over the FULL population; only `points` is down-sampled.
    r: pearson(points.map((pt) => ({ x: pt.fit, y: pt.success }))),
    meanSuccess: points.length ? round(mean(points.map((pt) => pt.success))) : 0,
    meanFit: points.length ? round(mean(points.map((pt) => pt.fit))) : 0,
    points: sample(points, MAX_SCATTER_POINTS),
  };
}

/**
 * Selection / pass rates per group with the 4/5ths-rule adverse-impact flag
 * (ARCHITECTURE §11). A group is flagged when its selection rate is below 80% of
 * the HIGHEST group's selection rate — the classic disparate-impact screen. NOTE
 * (and the UI states this plainly): protected-class demographics are NOT collected
 * by design (PDPL data-minimization), so the only available grouping is structural
 * (role family / profile); this is a selection-rate monitor, not an EEO study.
 */
export function selectionRates(rows: SelectionInput[]): SelectionRateRow[] {
  const groups = [...new Set(rows.map((r) => r.group))].sort();
  const base = groups.map((group) => {
    const g = rows.filter((r) => r.group === group);
    const selected = g.filter((r) => r.selected).length;
    const passed = g.filter((r) => r.passed).length;
    return {
      group,
      total: g.length,
      selected,
      selectionRate: g.length ? round(selected / g.length) : 0,
      passRate: g.length ? round(passed / g.length) : 0,
    };
  });
  const maxRate = Math.max(0, ...base.map((b) => b.selectionRate));
  return base.map((b) => ({
    ...b,
    // Only flag when there IS a reference rate and this group falls below 4/5ths of it.
    adverseFlag: maxRate > 0 && b.selectionRate < 0.8 * maxRate,
  }));
}

/**
 * Build the per-role-version calibration report, or an honest insufficient-data
 * state. Filters to hired, outcome-recorded candidates (the success-scored pairs);
 * a role version below MIN_OUTCOMES_FOR_REPORT yields `insufficient` (no report
 * persisted, no chart shown).
 */
export function buildCalibration(pairs: CalibrationPair[]): CalibrationOutcome {
  const scored = pairs.filter((p) => successScore(p.outcome) !== null);
  if (scored.length < MIN_OUTCOMES_FOR_REPORT) {
    return { kind: "insufficient", have: scored.length, need: MIN_OUTCOMES_FOR_REPORT };
  }
  return {
    kind: "ok",
    report: {
      sampleSize: scored.length,
      fit: fitSummary(scored),
      competencies: competencySignal(scored),
    },
  };
}
