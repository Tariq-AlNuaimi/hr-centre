import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { isScoringConfigured, requestScoring, ScoringError } from "@/lib/scoring";
import {
  draftResultNarrative,
  isLlmConfigured,
  LlmError,
  type ResultNarrativeInput,
} from "@/lib/llm";
import {
  rollUp,
  type RollupResult,
  type CompetencyScoreRow,
  type DomainScoreRow,
  type FacetScoreRow,
  type SjtScores,
} from "@/lib/scoring-rollup";
import type { DecisionInput, DecisionOutcomeValue } from "@/lib/validations/result";

// Service layer for Phase-6 results (ARCHITECTURE §6, UI-SPEC D.1/D.6/D.7/D.8).
// Owns: lazy compute-on-view + persist of the deterministic roll-up, the AI Role 2
// narrative cache, the human decision, and every tenant-scoped read the dashboard /
// candidates / single-result / compare surfaces need. Reads go through the audited,
// soft-delete-filtered `prisma` client and are ALWAYS scoped by orgId. The SJT
// scoringKey is never persisted (only derived sub-scores) and never returned.

// ---- Persisted-blob shapes (the roll-up output, read back off the JSON columns) ----

export type ResultScores = {
  facetScores: FacetScoreRow[];
  domainScores: DomainScoreRow[];
  competencyScores: CompetencyScoreRow[];
  sjtScores: SjtScores;
};

// The full evidence-trail payload the result page + PDF render (UI-SPEC D.7).
export type ResultView = {
  resultId: string;
  assessmentId: string;
  candidateEmail: string;
  candidateName: string | null;
  roleTitle: string;
  roleFamily: string;
  roleProfileId: string;
  roleProfileVersion: number;
  fitScore: number;
  communityPercentile: number | null;
  scoringModel: string;
  computedAt: Date;
  scores: ResultScores;
  narrative: string | null;
  narrativeModel: string | null;
  narrativeAt: Date | null;
  decision: DecisionOutcomeValue | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  decidedByName: string | null;
  completedAt: Date | null;
};

// Honest, typed outcomes (UI-SPEC D.7 states) — never a 500 or a green panel over
// a failure. The RSC page maps each to a calm, specific UI state.
export type ComputeOutcome =
  | { kind: "ok"; result: ResultView }
  | { kind: "not-found" }
  | { kind: "not-submitted" }
  | { kind: "incomplete"; have: number; need: number }
  | { kind: "no-active-profile" }
  | { kind: "scoring-not-configured" }
  | { kind: "scoring-unreachable"; detail: string };

const ASSESSMENT_WITH_CONTEXT = {
  invitation: {
    select: {
      candidateEmail: true,
      candidateName: true,
      roleProfile: {
        select: {
          id: true,
          title: true,
          version: true,
          roleFamily: { select: { name: true } },
          competencies: {
            select: {
              name: true,
              weight: true,
              direction: true,
              targetPercentile: true,
              onetRef: true,
              importance: true,
              sourceCitation: true,
              facets: { select: { facet: true } },
            },
          },
          // scoringKey is needed server-side to score SJT; it NEVER leaves this service.
          sjtItems: { select: { id: true, scoringKey: true } },
        },
      },
    },
  },
  itemResponses: { select: { itemNumber: true, value: true } },
  sjtResponses: { select: { sjtItemId: true, chosenOptionId: true } },
} satisfies Prisma.AssessmentSelect;

// Decode the JSON scoringKey blob into the ids the roll-up needs (defensive: a
// malformed key yields a non-keyable item, never a throw).
function decodeSjtKey(scoringKey: Prisma.JsonValue): {
  bestOptionId: string;
  worstOptionId: string | null;
} {
  const k = (scoringKey ?? {}) as { bestOptionId?: unknown; worstOptionId?: unknown };
  return {
    bestOptionId: typeof k.bestOptionId === "string" ? k.bestOptionId : "",
    worstOptionId: typeof k.worstOptionId === "string" ? k.worstOptionId : null,
  };
}

function toView(
  row: {
    id: string;
    assessmentId: string;
    roleProfileId: string;
    roleProfileVersion: number;
    fitScore: number;
    communityPercentile: number | null;
    scoringModel: string;
    computedAt: Date;
    facetScores: Prisma.JsonValue;
    domainScores: Prisma.JsonValue;
    competencyScores: Prisma.JsonValue;
    sjtScores: Prisma.JsonValue;
    narrative: string | null;
    narrativeModel: string | null;
    narrativeAt: Date | null;
    decision: DecisionOutcomeValue | null;
    decisionNote: string | null;
    decidedAt: Date | null;
  },
  ctx: {
    candidateEmail: string;
    candidateName: string | null;
    roleTitle: string;
    roleFamily: string;
    completedAt: Date | null;
    decidedByName: string | null;
  }
): ResultView {
  return {
    resultId: row.id,
    assessmentId: row.assessmentId,
    candidateEmail: ctx.candidateEmail,
    candidateName: ctx.candidateName,
    roleTitle: ctx.roleTitle,
    roleFamily: ctx.roleFamily,
    roleProfileId: row.roleProfileId,
    roleProfileVersion: row.roleProfileVersion,
    fitScore: row.fitScore,
    communityPercentile: row.communityPercentile,
    scoringModel: row.scoringModel,
    computedAt: row.computedAt,
    scores: {
      facetScores: row.facetScores as unknown as FacetScoreRow[],
      domainScores: row.domainScores as unknown as DomainScoreRow[],
      competencyScores: row.competencyScores as unknown as CompetencyScoreRow[],
      sjtScores: row.sjtScores as unknown as SjtScores,
    },
    narrative: row.narrative,
    narrativeModel: row.narrativeModel,
    narrativeAt: row.narrativeAt,
    decision: row.decision,
    decisionNote: row.decisionNote,
    decidedAt: row.decidedAt,
    decidedByName: ctx.decidedByName,
    completedAt: ctx.completedAt,
  };
}

// Resolve the display name of the decider (plain id, one bounded same-org lookup).
async function deciderName(orgId: string, decidedById: string | null): Promise<string | null> {
  if (!decidedById) return null;
  const u = await prisma.user.findFirst({
    where: { id: decidedById, orgId },
    select: { name: true, email: true },
  });
  return u ? u.name ?? u.email : null;
}

/**
 * Lazy compute-on-view + persist (Phase-6 blueprint). If a Result already exists it
 * is returned as-is (computed once, not per view) unless `force` recomputes. Gated
 * by isScoringConfigured(): with no scorer, returns a typed "not configured" outcome
 * and writes NOTHING (no partial Result). Tenant-scoped by orgId throughout.
 */
export async function computeResult(
  orgId: string,
  assessmentId: string,
  opts: { force?: boolean } = {}
): Promise<ComputeOutcome> {
  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, orgId },
    select: { id: true, status: true, submittedAt: true, ...ASSESSMENT_WITH_CONTEXT },
  });
  if (!assessment) return { kind: "not-found" };

  // Load any already-computed (live) result once. It both short-circuits the
  // common cached read AND decides create-vs-update below, so `force` never tries
  // to update a row that doesn't exist yet (that would throw P2025 → an opaque
  // 500; the recompute button / a ?recompute=1 link hit before the first compute
  // is a real path).
  const cached = await getResultByAssessment(orgId, assessmentId);
  if (cached && !opts.force) return { kind: "ok", result: cached };

  if (assessment.status !== "SUBMITTED") return { kind: "not-submitted" };

  const profile = assessment.invitation.roleProfile;
  if (!profile) return { kind: "no-active-profile" };

  if (assessment.itemResponses.length !== 120) {
    return { kind: "incomplete", have: assessment.itemResponses.length, need: 120 };
  }

  if (!isScoringConfigured()) return { kind: "scoring-not-configured" };

  // Deterministic scoring across the trust boundary (ARCHITECTURE §6 steps 1–2).
  let score;
  try {
    score = await requestScoring({
      answers: assessment.itemResponses.map((r) => ({ itemNumber: r.itemNumber, response: r.value })),
    });
  } catch (e) {
    const detail = e instanceof ScoringError ? e.message : "scoring failed";
    return { kind: "scoring-unreachable", detail };
  }

  const rollup: RollupResult = rollUp({
    score,
    competencies: profile.competencies.map((c) => ({
      name: c.name,
      weight: c.weight,
      direction: c.direction,
      targetPercentile: c.targetPercentile,
      facets: c.facets.map((f) => f.facet),
      onetRef: c.onetRef,
      importance: c.importance,
      sourceCitation: c.sourceCitation,
    })),
    sjtItems: profile.sjtItems.map((s) => ({ id: s.id, ...decodeSjtKey(s.scoringKey) })),
    sjtResponses: assessment.sjtResponses.map((r) => ({
      sjtItemId: r.sjtItemId,
      chosenOptionId: r.chosenOptionId,
    })),
  });

  const data = {
    orgId,
    assessmentId,
    roleProfileId: profile.id,
    roleProfileVersion: profile.version,
    facetScores: rollup.facetScores as unknown as Prisma.InputJsonValue,
    domainScores: rollup.domainScores as unknown as Prisma.InputJsonValue,
    sjtScores: rollup.sjtScores as unknown as Prisma.InputJsonValue,
    competencyScores: rollup.competencyScores as unknown as Prisma.InputJsonValue,
    fitScore: rollup.fitScore,
    communityPercentile: rollup.communityPercentile,
    scoringModel: score.model,
    // Stamp every (re)compute so the result page shows when the scores were last
    // produced (create also has a @default, but a recompute must move it forward).
    computedAt: new Date(),
  };

  try {
    if (cached) {
      // Recompute over an existing LIVE result: overwrite the score blobs only —
      // `data` deliberately omits decision/narrative fields, so the human decision
      // and the cached narrative survive a recompute.
      await prisma.result.update({ where: { assessmentId }, data });
    } else {
      await prisma.result.create({ data });
    }
  } catch (e) {
    // Unique race (two first-views compute at once): the other write won — re-read
    // it. (Result is created exactly once per assessment via the @unique slot.)
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const raced = await getResultByAssessment(orgId, assessmentId);
      if (raced) return { kind: "ok", result: raced };
      // The colliding row exists but isn't live (a soft-deleted/erased result holds
      // the unique slot). Not reachable through any Phase-6 path today, but report
      // it honestly instead of throwing an opaque 500.
      return { kind: "scoring-unreachable", detail: "a prior result record blocks this assessment" };
    }
    throw e;
  }

  const view = await getResultByAssessment(orgId, assessmentId);
  if (!view) return { kind: "scoring-unreachable", detail: "result persisted but not re-readable" };
  return { kind: "ok", result: view };
}

/** Tenant-scoped read of a persisted Result by assessment id (no compute). */
export async function getResultByAssessment(
  orgId: string,
  assessmentId: string
): Promise<ResultView | null> {
  const row = await prisma.result.findFirst({
    where: { assessmentId, orgId },
    select: RESULT_SELECT,
  });
  if (!row) return null;
  return hydrate(orgId, row);
}

/** Tenant-scoped read of a persisted Result by its own id (no compute). */
export async function getResultById(orgId: string, resultId: string): Promise<ResultView | null> {
  const row = await prisma.result.findFirst({
    where: { id: resultId, orgId },
    select: RESULT_SELECT,
  });
  if (!row) return null;
  return hydrate(orgId, row);
}

const RESULT_SELECT = {
  id: true,
  assessmentId: true,
  roleProfileId: true,
  roleProfileVersion: true,
  fitScore: true,
  communityPercentile: true,
  scoringModel: true,
  computedAt: true,
  facetScores: true,
  domainScores: true,
  competencyScores: true,
  sjtScores: true,
  narrative: true,
  narrativeModel: true,
  narrativeAt: true,
  decision: true,
  decisionNote: true,
  decidedById: true,
  decidedAt: true,
  assessment: {
    select: {
      submittedAt: true,
      invitation: {
        select: {
          candidateEmail: true,
          candidateName: true,
          roleProfile: { select: { title: true, roleFamily: { select: { name: true } } } },
        },
      },
    },
  },
} satisfies Prisma.ResultSelect;

type ResultRow = Prisma.ResultGetPayload<{ select: typeof RESULT_SELECT }>;

async function hydrate(orgId: string, row: ResultRow): Promise<ResultView> {
  const inv = row.assessment.invitation;
  return toView(row, {
    candidateEmail: inv.candidateEmail,
    candidateName: inv.candidateName,
    roleTitle: inv.roleProfile.title,
    roleFamily: inv.roleProfile.roleFamily.name,
    completedAt: row.assessment.submittedAt,
    decidedByName: await deciderName(orgId, row.decidedById),
  });
}

// ---- AI Role 2 narrative (generate + cache) ----

export type NarrativeOutcome =
  | { kind: "ok"; narrative: string }
  | { kind: "not-found" }
  | { kind: "llm-not-configured" }
  | { kind: "llm-failed"; detail: string };

/** Build the numbers-only narrative input from a persisted Result (NO PII, NO JD). */
function narrativeInput(view: ResultView): ResultNarrativeInput {
  return {
    roleTitle: view.roleTitle,
    fitScore: view.fitScore,
    competencies: view.scores.competencyScores.map((c) => ({
      name: c.name,
      score: c.score,
      band: c.band,
      targetPercentile: c.targetPercentile,
      direction: c.direction,
    })),
    domains: view.scores.domainScores.map((d) => ({ domain: d.domain, percentile: d.percentile })),
    sjtOverall: view.scores.sjtScores.overall,
  };
}

/** Generate (or regenerate) the AI Role 2 narrative and cache it on the Result. */
export async function generateNarrative(orgId: string, resultId: string): Promise<NarrativeOutcome> {
  const view = await getResultById(orgId, resultId);
  if (!view) return { kind: "not-found" };
  if (!isLlmConfigured()) return { kind: "llm-not-configured" };

  let narrative: string;
  let model: string;
  try {
    const res = await draftResultNarrative(narrativeInput(view));
    narrative = res.narrative;
    model = res.model;
  } catch (e) {
    return { kind: "llm-failed", detail: e instanceof LlmError ? e.message : "narrative failed" };
  }

  // Tenancy anchor: `view` came from the orgId-scoped getResultById above, so the
  // update-by-id is owned by this org (the established read-then-update-by-unique-id
  // convention, cf. lib/services/invitation.ts — keeps the write inside the audit
  // extension, which updateMany/compound-where would bypass).
  await prisma.result.update({
    where: { id: resultId },
    data: { narrative, narrativeModel: model, narrativeAt: new Date() },
  });
  return { kind: "ok", narrative };
}

// ---- Human decision (UI-SPEC D.7 §7) ----

export type DecisionOutcomeResult =
  | { kind: "ok"; result: ResultView }
  | { kind: "not-found" };

/**
 * Record / change the single current decision on a Result (the tool never decides).
 * Audited automatically (the Result update lands an audit row with before/after);
 * the change history therefore lives in audit_logs (Phase-6 blueprint). A Result
 * only exists for a SUBMITTED + computed assessment, so "decide before compute" is a
 * not-found here and the route surfaces it as 409.
 */
export async function recordDecision(
  orgId: string,
  resultId: string,
  userId: string,
  input: DecisionInput
): Promise<DecisionOutcomeResult> {
  const existing = await prisma.result.findFirst({
    where: { id: resultId, orgId },
    select: { id: true },
  });
  if (!existing) return { kind: "not-found" };

  // Tenancy anchor: `existing` came from the orgId-scoped findFirst above, so this
  // update-by-id is owned by this org (the established read-then-update-by-unique-id
  // convention, cf. lib/services/invitation.ts — keeps the decision write inside the
  // audit extension so who-decided-what is recorded; updateMany would bypass audit).
  await prisma.result.update({
    where: { id: resultId },
    data: {
      decision: input.decision,
      decisionNote: input.note ?? null,
      decidedById: userId,
      decidedAt: new Date(),
    },
  });
  const view = await getResultById(orgId, resultId);
  return view ? { kind: "ok", result: view } : { kind: "not-found" };
}

// ---- Candidates list (UI-SPEC D.6) ----

export type CandidateRow = {
  assessmentId: string;
  resultId: string | null;
  candidateEmail: string;
  candidateName: string | null;
  roleProfileId: string;
  roleTitle: string;
  roleFamily: string;
  status: string; // assessment status (SUBMITTED = completed)
  completedAt: Date | null;
  fitScore: number | null;
  decision: DecisionOutcomeValue | null;
};

export type CandidateFilters = {
  skip: number;
  take: number;
  roleProfileId?: string;
  decision?: DecisionOutcomeValue;
  /** Only SUBMITTED sittings (completed) — the default the list shows. */
  submittedOnly?: boolean;
  /** Only sittings awaiting a decision (the dashboard backlog) — see awaitingReviewWhere. */
  undecided?: boolean;
};

// Single source of truth for "awaiting review" so the dashboard TILE (a count) and
// the dashboard PANEL (a listCandidates page) can never disagree. A sitting awaits
// review when it has NO result yet (un-viewed → lazy compute pending) OR a LIVE
// result with no decision. A soft-deleted result is deliberately excluded — an
// erased result is not an actionable backlog item (the nested relation filter is NOT
// soft-delete-filtered by the extension, so deletedAt:null is explicit here).
function awaitingReviewWhere(): Prisma.AssessmentWhereInput {
  return { OR: [{ result: { is: null } }, { result: { decision: null, deletedAt: null } }] };
}

/** Tenant-scoped, bounded, paginated candidates/results list. No N+1 (result joined). */
export async function listCandidates(
  orgId: string,
  filters: CandidateFilters
): Promise<{ data: CandidateRow[]; total: number }> {
  const where: Prisma.AssessmentWhereInput = {
    orgId,
    ...(filters.submittedOnly ? { status: "SUBMITTED" } : {}),
    ...(filters.roleProfileId
      ? { invitation: { roleProfileId: filters.roleProfileId } }
      : {}),
    // Nested relation filter: the soft-delete extension only injects deletedAt:null
    // on the TOP-LEVEL where (documented limitation), so scope the Result here too
    // — a soft-deleted result must not surface a stale decision in the list.
    ...(filters.decision ? { result: { decision: filters.decision, deletedAt: null } } : {}),
    ...(filters.undecided ? awaitingReviewWhere() : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.assessment.findMany({
      where,
      skip: filters.skip,
      take: filters.take,
      orderBy: { submittedAt: "desc" },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        invitation: {
          select: {
            candidateEmail: true,
            candidateName: true,
            roleProfileId: true,
            roleProfile: { select: { title: true, roleFamily: { select: { name: true } } } },
          },
        },
        // deletedAt is selected so a soft-deleted result can be filtered out below:
        // the soft-delete extension only injects deletedAt:null on the TOP-LEVEL
        // where, not on a nested to-one read (and a to-one `select` can't take a
        // `where`), so an erased result would otherwise leak its fitScore/decision.
        result: { select: { id: true, fitScore: true, decision: true, deletedAt: true } },
      },
    }),
    prisma.assessment.count({ where }),
  ]);

  const data: CandidateRow[] = rows.map((r) => {
    // Treat a soft-deleted result as absent — never surface a stale score/decision.
    const result = r.result && !r.result.deletedAt ? r.result : null;
    return {
      assessmentId: r.id,
      resultId: result?.id ?? null,
      candidateEmail: r.invitation.candidateEmail,
      candidateName: r.invitation.candidateName,
      roleProfileId: r.invitation.roleProfileId,
      roleTitle: r.invitation.roleProfile.title,
      roleFamily: r.invitation.roleProfile.roleFamily.name,
      status: r.status,
      completedAt: r.submittedAt,
      fitScore: result?.fitScore ?? null,
      decision: result?.decision ?? null,
    };
  });
  return { data, total };
}

// ---- Compare (UI-SPEC D.8) — single role, cap 6 ----

export const COMPARE_MAX = 6;

export type CompareOutcome =
  | { kind: "ok"; roleTitle: string; competencyNames: string[]; candidates: ResultView[] }
  | { kind: "too-few" }
  | { kind: "too-many"; cap: number }
  | { kind: "cross-role" }
  | { kind: "not-found" };

/**
 * Compare 2–COMPARE_MAX computed results that MUST share one role (comparing across
 * roles is meaningless — UI-SPEC D.8 enforces it). Tenant-scoped; capped.
 */
export async function getCompareData(
  orgId: string,
  resultIds: string[]
): Promise<CompareOutcome> {
  const ids = [...new Set(resultIds)];
  if (ids.length < 2) return { kind: "too-few" };
  if (ids.length > COMPARE_MAX) return { kind: "too-many", cap: COMPARE_MAX };

  const rows = await prisma.result.findMany({
    where: { id: { in: ids }, orgId },
    select: RESULT_SELECT,
    take: COMPARE_MAX,
  });
  if (rows.length < 2) return { kind: "too-few" };

  const roleIds = new Set(rows.map((r) => r.roleProfileId));
  if (roleIds.size > 1) return { kind: "cross-role" };

  const candidates = await Promise.all(rows.map((r) => hydrate(orgId, r)));
  // Competency axis = the union of competency names across the compared results,
  // in the first candidate's order (they share a role, so the set matches).
  const competencyNames = candidates[0]?.scores.competencyScores.map((c) => c.name) ?? [];
  return {
    kind: "ok",
    roleTitle: candidates[0].roleTitle,
    competencyNames,
    candidates,
  };
}

// ---- Dashboard snapshot (UI-SPEC D.1) ----

export type DashboardSnapshot = {
  invited: number;
  started: number;
  completed: number;
  awaitingReview: number; // completed sittings with no decision yet
};

/** Tenant-scoped pipeline counts for the dashboard tiles (UI-SPEC D.1). */
export async function getDashboardSnapshot(orgId: string): Promise<DashboardSnapshot> {
  const [invited, started, completed, awaitingReview] = await Promise.all([
    prisma.invitation.count({ where: { orgId } }),
    prisma.assessment.count({ where: { orgId, status: { in: ["IN_PROGRESS", "SUBMITTED"] } } }),
    prisma.assessment.count({ where: { orgId, status: "SUBMITTED" } }),
    // "Awaiting review" = COMPLETED sittings without a recorded decision, via the
    // shared awaitingReviewWhere() so this TILE count and the dashboard PANEL list
    // (listCandidates {undecided:true}) can never disagree (code-review). Counts
    // un-viewed sittings (no Result yet) + live undecided results; excludes
    // soft-deleted results (an erased result isn't an actionable backlog item).
    prisma.assessment.count({ where: { orgId, status: "SUBMITTED", ...awaitingReviewWhere() } }),
  ]);
  return { invited, started, completed, awaitingReview };
}
