import type { PrismaClient } from "../generated/prisma/client";
import { IPIP_FACETS_BY_DOMAIN, type Big5DomainKey } from "../lib/ipip-facets";
import { generateInvitationToken, hashInvitationToken } from "../lib/token";
import { rollUp, type RollupCompetency } from "../lib/scoring-rollup";
import type { ScoreResponse } from "../lib/validations/scoring";

// Phase-6 DEMO data (gated behind SEED_SAMPLE_DATA=1). Exercises the results UI on
// a deployment WITHOUT a live Python scorer: it seeds completed sittings AND, for
// most of them, a PRECOMPUTED Result produced by the SAME pure roll-up the runtime
// uses — fed synthetic facet percentiles standing in for the scorer's output. One
// candidate is left scored-but-uncomputed so the "scoring not configured" branch is
// visible too. Idempotent: keyed on stable candidate emails; skips if already seeded.
//
// This is clearly-labelled sample data, NOT real candidates. It never runs unless
// SEED_SAMPLE_DATA=1, so a real handoff deployment stays clean.

const SCORE_BAND = (p: number): "low" | "average" | "high" => (p < 35 ? "low" : p > 65 ? "high" : "average");

// Build a full 30-facet ScoreResponse from a per-facet percentile map (defaults to
// 50 for any facet not named), mirroring the Python service's validated shape.
function syntheticScore(percentiles: Record<string, number>): ScoreResponse {
  const domains = (Object.entries(IPIP_FACETS_BY_DOMAIN) as [Big5DomainKey, readonly string[]][]).map(
    ([domain, facets]) => {
      const facetRows = facets.map((facet, i) => {
        const percentile = percentiles[facet] ?? 50;
        return { facet, facetNumber: i + 1, raw: Math.round(percentile / 2), percentile, score: SCORE_BAND(percentile) };
      });
      const avg = Math.round(facetRows.reduce((a, f) => a + f.percentile, 0) / facetRows.length);
      return { domain, raw: Math.round(avg / 2), percentile: avg, score: SCORE_BAND(avg), facets: facetRows };
    }
  );
  return {
    model: "IPIP-NEO-120" as const,
    deterministic: true,
    norms: { source: "Johnson 2014 (synthetic demo)", via: "five-factor-e", sex: "N" as const, age: 30 },
    domains,
  };
}

// Four demo candidates for one role — a strong fit, a mixed profile, a below-target
// profile (for compare variety), and one with NO precomputed result (scoring-not-
// configured branch). High C / high E / LOW N reads as strong sales fit.
const CANDIDATES: Array<{
  email: string;
  name: string;
  percentiles?: Record<string, number>; // omitted = submitted but NOT scored
}> = [
  {
    email: "sara.strong@example.com",
    name: "Sara Strong",
    percentiles: { achievement_striving: 88, self_discipline: 82, self_efficacy: 80, assertiveness: 78, activity_level: 72, vulnerability: 18, anxiety: 22, friendliness: 70, altruism: 68, dutifulness: 75 },
  },
  {
    email: "maya.mixed@example.com",
    name: "Maya Mixed",
    percentiles: { achievement_striving: 62, self_discipline: 48, assertiveness: 55, vulnerability: 45, anxiety: 50, friendliness: 60, dutifulness: 58, orderliness: 52 },
  },
  {
    email: "omar.okay@example.com",
    name: "Omar Okay",
    percentiles: { achievement_striving: 40, self_discipline: 38, assertiveness: 35, vulnerability: 70, anxiety: 65, friendliness: 45, dutifulness: 42 },
  },
  {
    email: "nadia.notscored@example.com",
    name: "Nadia (awaiting scoring)",
    // no percentiles → submitted, no Result row → exercises the "not configured" UI.
  },
];

export async function seedSampleData(prisma: PrismaClient, orgId: string): Promise<void> {
  // Use an ACTIVE starter profile (Sales) with its competencies + facets + SJT.
  const profile = await prisma.roleProfile.findFirst({
    where: { orgId, status: "ACTIVE", lineageId: "starter:sales" },
    select: {
      id: true,
      version: true,
      competencies: {
        select: {
          name: true, weight: true, direction: true, targetPercentile: true,
          onetRef: true, importance: true, sourceCitation: true,
          facets: { select: { facet: true } },
        },
      },
      sjtItems: { select: { id: true, scoringKey: true } },
    },
  });
  if (!profile) {
    console.warn("Sample data: no ACTIVE starter:sales profile found, skipping.");
    return;
  }

  const competencies: RollupCompetency[] = profile.competencies.map((c) => ({
    name: c.name, weight: c.weight, direction: c.direction, targetPercentile: c.targetPercentile,
    facets: c.facets.map((f) => f.facet), onetRef: c.onetRef, importance: c.importance, sourceCitation: c.sourceCitation,
  }));
  const sjtItems = profile.sjtItems.map((s) => {
    const k = (s.scoringKey ?? {}) as { bestOptionId?: string; worstOptionId?: string | null };
    return { id: s.id, bestOptionId: k.bestOptionId ?? "", worstOptionId: k.worstOptionId ?? null };
  });

  for (const cand of CANDIDATES) {
    const existing = await prisma.invitation.findFirst({
      where: { orgId, candidateEmail: cand.email },
      select: { id: true },
    });
    if (existing) continue;

    const invitation = await prisma.invitation.create({
      data: {
        orgId,
        roleProfileId: profile.id,
        candidateEmail: cand.email,
        candidateName: cand.name,
        tokenHash: hashInvitationToken(generateInvitationToken()),
        status: "COMPLETED",
        locale: "en",
      },
    });

    const now = new Date();
    const assessment = await prisma.assessment.create({
      data: {
        orgId,
        invitationId: invitation.id,
        status: "SUBMITTED",
        locale: "en",
        consentAt: now,
        startedAt: now,
        submittedAt: now,
        // 120 neutral responses so a completed sitting is real (the precomputed
        // Result below stands in for the scorer; recompute would hit the gate).
        itemResponses: { create: Array.from({ length: 120 }, (_, i) => ({ itemNumber: i + 1, value: 3 })) },
      },
    });

    if (!cand.percentiles) continue; // submitted, intentionally left uncomputed.

    const score = syntheticScore(cand.percentiles);
    const rollup = rollUp({ score, competencies, sjtItems, sjtResponses: [] });
    await prisma.result.create({
      data: {
        orgId,
        assessmentId: assessment.id,
        roleProfileId: profile.id,
        roleProfileVersion: profile.version,
        facetScores: rollup.facetScores as object,
        domainScores: rollup.domainScores as object,
        sjtScores: rollup.sjtScores as object,
        competencyScores: rollup.competencyScores as object,
        fitScore: rollup.fitScore,
        communityPercentile: rollup.communityPercentile,
        scoringModel: score.model,
      },
    });
  }
  console.log(`Sample data seeded: ${CANDIDATES.length} demo candidates (${CANDIDATES.filter((c) => c.percentiles).length} with precomputed results).`);
}
