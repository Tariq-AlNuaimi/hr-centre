import type { ScoreResponse } from "./validations/scoring";

/**
 * Deterministic scoring ROLL-UP (ARCHITECTURE §6, Phase-6 blueprint). PURE: no
 * I/O, no Prisma, no env — every output is a function of its inputs, so the whole
 * file is exhaustively unit-testable (tests/contracts/scoring-rollup.test.ts). The
 * raw→facet/domain + percentile step is NOT here: that stays in the Python
 * `services/scoring` service (we adopt `five-factor-e`, never re-transcribe IPIP
 * keys — ARCHITECTURE §3/§6). This module consumes the scorer's validated
 * `ScoreResponse` and turns it into the decomposed, source-traceable result the
 * manager sees: facet → competency → fit, plus a separate SJT judgement signal.
 *
 * The arithmetic and thresholds live in code (traceable to the role profile's
 * O*NET/literature-anchored bands), NEVER the LLM — that line is what keeps the
 * result defensible (ARCHITECTURE §4/§6). The formulas are documented inline and
 * surfaced on the /methodology page (Phase 8).
 */

export type BandDirection = "HIGH" | "MODERATE" | "LOW";

/** Competency band outcome — a calm 3-tone scale, never traffic-light (UI-SPEC A.2). */
export type CompetencyBand = "PASS" | "PARTIAL" | "BELOW";

/** How a SJT item was answered, relative to the (server-only) key. */
export type SjtChoice = "best" | "worst" | "other" | "unanswered";

// ---- Inputs (plain shapes; the service maps Prisma rows onto these) ----

/** A role-profile competency as the roll-up needs it (subset of the Prisma row). */
export type RollupCompetency = {
  name: string;
  weight: number;
  direction: BandDirection;
  targetPercentile: number;
  /** IPIP facet machine-names that operationalize this competency (≥1). */
  facets: string[];
  onetRef?: string | null;
  importance?: number | null;
  sourceCitation?: string | null;
};

/** A SJT item's key — stays SERVER-SIDE; only the derived `score` ever leaves. */
export type RollupSjtItem = {
  id: string;
  bestOptionId: string;
  worstOptionId?: string | null;
};

export type RollupSjtResponse = {
  sjtItemId: string;
  chosenOptionId: string;
};

// ---- Outputs (persisted as JSON on Result; validated by lib/validations/result.ts) ----

export type FacetScoreRow = {
  facet: string;
  facetNumber: number;
  domain: string;
  raw: number;
  percentile: number;
  band: "low" | "average" | "high";
};

export type DomainScoreRow = {
  domain: string;
  raw: number;
  percentile: number;
  band: "low" | "average" | "high";
};

/** A facet that drove a competency score — the evidence-trail leaf (UI-SPEC D.7 §3). */
export type CompetencyDriver = {
  facet: string;
  percentile: number;
  /** Direction-normalized contribution (higher = better) — see facetContribution. */
  contribution: number;
};

export type CompetencyScoreRow = {
  name: string;
  score: number;
  band: CompetencyBand;
  direction: BandDirection;
  targetPercentile: number;
  weight: number;
  drivers: CompetencyDriver[];
  onetRef: string | null;
  sourceCitation: string | null;
};

export type SjtItemScore = {
  sjtItemId: string;
  choice: SjtChoice;
  /** 1 = chose best, 0 = chose worst, 0.5 = other/neither, null = unanswered. */
  score: number | null;
};

export type SjtScores = {
  /** 0–100 overall judgement signal (mean of answered item scores ×100), or null. */
  overall: number | null;
  answered: number;
  total: number;
  items: SjtItemScore[];
};

export type RollupResult = {
  facetScores: FacetScoreRow[];
  domainScores: DomainScoreRow[];
  competencyScores: CompetencyScoreRow[];
  sjtScores: SjtScores;
  fitScore: number;
  /** Secondary norm-referenced figure: mean of the 5 domain percentiles (ARCHITECTURE §6). */
  communityPercentile: number | null;
};

// ---- Pure functions ----

/** Round to an integer in [0, 100]. */
function clamp100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Direction-normalized facet contribution so that, on EVERY competency, a higher
 * number is a better fit regardless of whether the target is high/low/moderate
 * (ARCHITECTURE §6 step 4, Phase-6 blueprint):
 *   HIGH      → percentile                       (e.g. Achievement-Striving for Sales)
 *   LOW       → 100 − percentile                 (e.g. low-Neuroticism facets for Support)
 *   MODERATE  → max(0, 100 − 2·|percentile − target|)  (peaks at the target, falls off either side)
 * Output is clamped to [0, 100].
 */
export function facetContribution(
  percentile: number,
  direction: BandDirection,
  targetPercentile: number
): number {
  switch (direction) {
    case "HIGH":
      return clamp100(percentile);
    case "LOW":
      return clamp100(100 - percentile);
    case "MODERATE":
      return clamp100(100 - 2 * Math.abs(percentile - targetPercentile));
  }
}

/**
 * Band a competency score against its target (Phase-6 blueprint):
 *   PASS    score ≥ target
 *   PARTIAL score ≥ target − 15
 *   BELOW   otherwise
 */
export function bandFor(score: number, targetPercentile: number): CompetencyBand {
  if (score >= targetPercentile) return "PASS";
  if (score >= targetPercentile - 15) return "PARTIAL";
  return "BELOW";
}

/** Build a facet machine-name → facet row lookup from the scorer's domains. */
function facetIndex(score: ScoreResponse): Map<string, FacetScoreRow> {
  const idx = new Map<string, FacetScoreRow>();
  for (const d of score.domains) {
    for (const f of d.facets) {
      idx.set(f.facet, {
        facet: f.facet,
        facetNumber: f.facetNumber,
        domain: d.domain,
        raw: f.raw,
        percentile: f.percentile,
        band: f.score,
      });
    }
  }
  return idx;
}

/**
 * Score the SJT items as an OVERALL judgement signal. The Phase 1–5 schema has no
 * SjtItem→Competency link, so SJT is NOT folded into competency scores (that would
 * require attributing each scenario to a competency); it is surfaced as its own
 * judgement number (UI-SPEC D.7 §5). The key (`bestOptionId`/`worstOptionId`) never
 * leaves this function — only the derived per-item `score` and the aggregate do.
 *   chose best  → 1.0
 *   chose worst → 0.0
 *   other       → 0.5   (a defensible middle for a non-keyed choice)
 *   unanswered  → null  (excluded from the mean)
 */
export function scoreSjt(
  items: RollupSjtItem[],
  responses: RollupSjtResponse[]
): SjtScores {
  const byItem = new Map(responses.map((r) => [r.sjtItemId, r.chosenOptionId]));
  const rows: SjtItemScore[] = items.map((item) => {
    const chosen = byItem.get(item.id);
    if (chosen == null) return { sjtItemId: item.id, choice: "unanswered", score: null };
    if (chosen === item.bestOptionId) return { sjtItemId: item.id, choice: "best", score: 1 };
    if (item.worstOptionId && chosen === item.worstOptionId)
      return { sjtItemId: item.id, choice: "worst", score: 0 };
    return { sjtItemId: item.id, choice: "other", score: 0.5 };
  });

  const answeredScores = rows
    .map((r) => r.score)
    .filter((s): s is number => s !== null);
  const overall =
    answeredScores.length > 0
      ? clamp100((answeredScores.reduce((a, b) => a + b, 0) / answeredScores.length) * 100)
      : null;

  return { overall, answered: answeredScores.length, total: items.length, items: rows };
}

/**
 * Score one competency: the (unweighted) mean of its mapped facets' direction-
 * normalized contributions. Facets the scorer didn't return are skipped; a
 * competency whose facets are all missing scores 0 / BELOW (defensive — shouldn't
 * happen with a full 120-item sitting).
 */
export function scoreCompetency(
  comp: RollupCompetency,
  facets: Map<string, FacetScoreRow>
): CompetencyScoreRow {
  const drivers: CompetencyDriver[] = [];
  for (const facetName of comp.facets) {
    const f = facets.get(facetName);
    if (!f) continue;
    drivers.push({
      facet: facetName,
      percentile: f.percentile,
      contribution: facetContribution(f.percentile, comp.direction, comp.targetPercentile),
    });
  }
  const score =
    drivers.length > 0
      ? clamp100(drivers.reduce((a, d) => a + d.contribution, 0) / drivers.length)
      : 0;
  return {
    name: comp.name,
    score,
    band: bandFor(score, comp.targetPercentile),
    direction: comp.direction,
    targetPercentile: comp.targetPercentile,
    weight: comp.weight,
    drivers,
    onetRef: comp.onetRef ?? null,
    sourceCitation: comp.sourceCitation ?? null,
  };
}

/**
 * The full roll-up (ARCHITECTURE §6). Given the scorer's response, the active
 * profile's competencies, and the SJT key + responses, produce the decomposed
 * result: facet rows, domain rows, per-competency scores+bands, the SJT judgement
 * signal, the weighted fit score, and the secondary community percentile.
 */
export function rollUp(args: {
  score: ScoreResponse;
  competencies: RollupCompetency[];
  sjtItems: RollupSjtItem[];
  sjtResponses: RollupSjtResponse[];
}): RollupResult {
  const facets = facetIndex(args.score);

  const facetScores: FacetScoreRow[] = [...facets.values()];
  const domainScores: DomainScoreRow[] = args.score.domains.map((d) => ({
    domain: d.domain,
    raw: d.raw,
    percentile: d.percentile,
    band: d.score,
  }));

  const competencyScores = args.competencies.map((c) => scoreCompetency(c, facets));

  // Fit = weight-weighted mean of competency scores (ARCHITECTURE §6 step 6). All
  // weights are validated > 0 at authoring, so the denominator is never 0 when
  // there is at least one competency.
  const totalWeight = competencyScores.reduce((a, c) => a + c.weight, 0);
  const fitScore =
    totalWeight > 0
      ? clamp100(
          competencyScores.reduce((a, c) => a + c.score * c.weight, 0) / totalWeight
        )
      : 0;

  const sjtScores = scoreSjt(args.sjtItems, args.sjtResponses);

  const communityPercentile =
    domainScores.length > 0
      ? clamp100(
          domainScores.reduce((a, d) => a + d.percentile, 0) / domainScores.length
        )
      : null;

  return {
    facetScores,
    domainScores,
    competencyScores,
    sjtScores,
    fitScore,
    communityPercentile,
  };
}
