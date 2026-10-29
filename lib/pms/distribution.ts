import type { Band } from "@/generated/prisma/client";

/**
 * Band distributions — pure and client-safe (no Prisma runtime import), so the
 * calibration chart and 9-box can share the server's arithmetic in the browser.
 * `lib/pms/calibration.ts` re-exports the tally helpers for its existing callers.
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
 * P2-1 — the rows behind the distribution chart: per band, the share of
 * headcount that is ACTUALLY there, beside the target share and (when a prior
 * cycle exists) last cycle's share. Percentages, not counts, so a 40-person
 * department and a 400-person org read on the same axis, and so this year's
 * shape compares with last year's even when headcount moved.
 *
 * One decimal place — the chart is for shape, the tiles carry the exact figures.
 * A zero headcount yields 0 rather than NaN: an empty cycle draws an empty chart.
 */
export function bandShareRows(params: {
  actual: Distribution;
  headcount: number;
  targetPct: Distribution | null;
  prior: { actual: Distribution; headcount: number } | null;
}): { band: Band; actual: number; target: number | null; prior: number | null }[] {
  const share = (n: number, of: number) => (of === 0 ? 0 : Math.round((n / of) * 1000) / 10);
  return BANDS.map((band) => ({
    band,
    actual: share(params.actual[band], params.headcount),
    target: params.targetPct ? Number(params.targetPct[band]) : null,
    prior: params.prior ? share(params.prior.actual[band], params.prior.headcount) : null,
  }));
}

/** P2-1 — the three rows of the 9-box, from the calibrated band. */
export type PerformanceTier = "HIGH" | "MID" | "LOW";
/** P2-1 — the three columns of the 9-box, from the §9.5 360 level (0–5). */
export type FeedbackTier = "LOW" | "MID" | "HIGH";

export function performanceTier(band: Band): PerformanceTier {
  if (band === "OUTSTANDING" || band === "EXCELLENT") return "HIGH";
  if (band === "TARGET") return "MID";
  return "LOW";
}

/** Below 3 is under "meets expectations" on the 5-point scale; 4 and above is strong. */
export function feedbackTier(level: number): FeedbackTier {
  if (level >= 4) return "HIGH";
  if (level >= 3) return "MID";
  return "LOW";
}

export type NineBoxCell = {
  performance: PerformanceTier;
  feedback: FeedbackTier;
  count: number;
  people: { employeeId: string; name: string }[];
};

/**
 * P2-1 — the optional 9-box: calibrated performance × 360 feedback.
 *
 * Like the gap table, it SHOWS and never moves anyone (§10.4). People with no
 * 360 level (C-Level track, or no form scored) are not forced into a column:
 * they are counted separately, because "no 360" placed in LOW would be a claim
 * about a real person nobody made.
 *
 * Every one of the nine cells is returned, empty ones included, best-first.
 */
export function nineBox(
  scores: readonly {
    employeeId: string;
    name: string;
    calibratedBand: Band;
    threeSixtyLevel: number | null;
  }[],
): { cells: NineBoxCell[]; withoutFeedback: number } {
  const rows: PerformanceTier[] = ["HIGH", "MID", "LOW"];
  const cols: FeedbackTier[] = ["LOW", "MID", "HIGH"];
  const cells: NineBoxCell[] = rows.flatMap((performance) =>
    cols.map((feedback) => ({ performance, feedback, count: 0, people: [] })),
  );
  let withoutFeedback = 0;
  for (const s of scores) {
    if (s.threeSixtyLevel === null) {
      withoutFeedback += 1;
      continue;
    }
    const p = performanceTier(s.calibratedBand);
    const f = feedbackTier(s.threeSixtyLevel);
    const cell = cells.find((c) => c.performance === p && c.feedback === f);
    if (!cell) continue;
    cell.count += 1;
    cell.people.push({ employeeId: s.employeeId, name: s.name });
  }
  for (const c of cells) c.people.sort((a, b) => a.name.localeCompare(b.name));
  return { cells, withoutFeedback };
}
