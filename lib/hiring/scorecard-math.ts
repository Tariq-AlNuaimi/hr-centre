/**
 * Scorecard maths — Interview Hub `evaluation-comparison.ts`, pure: competency
 * averages over SUBMITTED scorecards, the weighted overall (a competency nobody
 * scored is left out, never counted as zero), coverage of the panel, and the
 * verdict (one vote per panelist — their latest round).
 */

export const HIRE_VOTES = ["STRONG_HIRE", "HIRE", "NO_HIRE", "STRONG_NO_HIRE"] as const;
export type HireVote = (typeof HIRE_VOTES)[number];

const POSITIVE: ReadonlySet<string> = new Set(["HIRE", "STRONG_HIRE"]);

export function isHireVote(v: unknown): v is HireVote {
  return typeof v === "string" && (HIRE_VOTES as readonly string[]).includes(v);
}

function normalizeCompetencyKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

type NormalizedScores = { byKey: Map<string, number>; byNormalized: Map<string, number> };

function normalizeScores(raw: unknown): NormalizedScores {
  const byKey = new Map<string, number>();
  const byNormalized = new Map<string, number>();
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { byKey, byNormalized };
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    byKey.set(key, value);
    const norm = normalizeCompetencyKey(key);
    if (!byNormalized.has(norm)) byNormalized.set(norm, value);
  }
  return { byKey, byNormalized };
}

/** Exact key first, then a forgiving match ("System Design" ≈ "system-design"). */
function scoreFor(scores: NormalizedScores, competency: string): number | null {
  return (
    scores.byKey.get(competency) ??
    scores.byNormalized.get(normalizeCompetencyKey(competency)) ??
    null
  );
}

export type ScorecardInput = {
  candidateId: string;
  interviewId: string;
  panelistId: string;
  round: number;
  submitted: boolean;
  vote: string | null;
  scores: unknown;
};
export type PreparedScorecard = ScorecardInput & {
  normalized: NormalizedScores;
  hireVote: HireVote | null;
};

export function prepareScorecard(input: ScorecardInput): PreparedScorecard {
  return {
    ...input,
    normalized: normalizeScores(input.scores),
    hireVote: input.submitted && isHireVote(input.vote) ? input.vote : null,
  };
}

export type CompetencyAverage = { competency: string; mean: number | null; count: number };

export function competencyAverages(
  competencies: readonly string[],
  scorecards: readonly PreparedScorecard[],
): CompetencyAverage[] {
  const submitted = scorecards.filter((s) => s.submitted);
  return competencies.map((competency) => {
    const values = submitted
      .map((c) => scoreFor(c.normalized, competency))
      .filter((v): v is number => v !== null);
    const sum = values.reduce((a, b) => a + b, 0);
    return { competency, mean: values.length ? sum / values.length : null, count: values.length };
  });
}

export function weightedOverall(averages: readonly CompetencyAverage[]): number | null {
  const scored = averages.filter((a) => a.mean !== null);
  if (scored.length === 0) return null;
  return scored.reduce((s, a) => s + (a.mean as number), 0) / scored.length;
}

export type Coverage = {
  expected: number;
  submitted: number;
  outstanding: number;
  complete: boolean;
  missing: { candidateId: string; panelistId: string; panelistName: string; round: number }[];
};

export function coverageOf(
  scorecards: readonly PreparedScorecard[],
  nameOf: (panelistId: string) => string,
): Coverage {
  const missing = scorecards
    .filter((c) => !c.submitted)
    .map((c) => ({
      candidateId: c.candidateId,
      panelistId: c.panelistId,
      panelistName: nameOf(c.panelistId),
      round: c.round,
    }))
    .sort((a, b) => a.round - b.round || a.panelistName.localeCompare(b.panelistName));
  return {
    expected: scorecards.length,
    submitted: scorecards.length - missing.length,
    outstanding: missing.length,
    complete: missing.length === 0 && scorecards.length > 0,
    missing,
  };
}

export type VerdictSummary = {
  tally: Record<HireVote, number>;
  total: number;
  unanimous: HireVote | null;
  majority: HireVote | null;
  positive: number;
};

/** One vote per panelist: the latest round they submitted. */
function latestVotePerPanelist(scorecards: readonly PreparedScorecard[]): PreparedScorecard[] {
  const best = new Map<string, PreparedScorecard>();
  for (const card of scorecards) {
    if (card.hireVote === null) continue;
    const current = best.get(card.panelistId);
    if (!current || card.round > current.round) best.set(card.panelistId, card);
  }
  return [...best.values()];
}

export function aggregateVerdict(input: readonly PreparedScorecard[]): VerdictSummary {
  const tally: Record<HireVote, number> = {
    STRONG_HIRE: 0,
    HIRE: 0,
    NO_HIRE: 0,
    STRONG_NO_HIRE: 0,
  };
  const votes = latestVotePerPanelist(input).map((c) => c.hireVote as HireVote);
  for (const v of votes) tally[v] += 1;
  const total = votes.length;
  const cast = HIRE_VOTES.filter((v) => tally[v] > 0);
  return {
    tally,
    total,
    unanimous: cast.length === 1 ? cast[0] : null,
    majority: cast.find((v) => tally[v] * 2 > total) ?? null,
    positive: cast.reduce((n, v) => n + (POSITIVE.has(v) ? tally[v] : 0), 0),
  };
}

/** "round 1", "both rounds", "rounds 1, 2 & 4". */
export function describeRounds(seen: readonly number[], total: number): string {
  const rounds = [...new Set(seen)].sort((a, b) => a - b);
  if (rounds.length === 0) return "no rounds";
  if (rounds.length === 1) return `round ${rounds[0]}`;
  if (rounds.length === total) return total === 2 ? "both rounds" : `all ${total} rounds`;
  return `rounds ${rounds.slice(0, -1).join(", ")} & ${rounds[rounds.length - 1]}`;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

type Divergence =
  { kind: "majority"; vote: HireVote } | { kind: "one"; vote: HireVote } | { kind: "split" };

/**
 * How my vote differs from the panel and the AI (Interview Hub compare,
 * Q-02): a "majority" is a strict majority of ALL human votes INCLUDING mine;
 * the AI is advisory and never counted. No majority → name the one dissenter,
 * or say the panel is split — never invent a majority.
 */
export function voteDivergence(
  mine: HireVote | null,
  peers: readonly HireVote[],
  ai: HireVote | null,
) {
  const out: { ai: HireVote | null; panel: Divergence | null } = { ai: null, panel: null };
  if (!mine) return out;
  if (ai && ai !== mine) out.ai = ai;
  if (peers.length === 0) return out;
  const all = [mine, ...peers];
  const tally = new Map<HireVote, number>();
  for (const v of all) tally.set(v, (tally.get(v) ?? 0) + 1);
  const [top, count] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (count * 2 > all.length) {
    if (top !== mine) out.panel = { kind: "majority", vote: top };
    return out;
  }
  const differing = peers.filter((v) => v !== mine);
  if (differing.length === 1) out.panel = { kind: "one", vote: differing[0] };
  else if (differing.length > 1) out.panel = { kind: "split" };
  return out;
}
