// Vibe Inspector — run orchestrator (ADR-016).
//
// Executes one TestRun synchronously: capture the site, run each selected dimension
// through Claude, persist results/findings/coverage, and roll up an overall score.
// Called from POST /api/assessments/[id]/runs inside the request's audit context, so
// all writes here are attributed to the triggering user.
//
// On any failure (engine not configured, browser launch, analysis), the run is marked
// FAILED with the reason — it never reports a false green.

import { prisma } from "@/lib/prisma";
import type { TestDimension } from "@/generated/prisma/client";
import { DIMENSION_ORDER, DIMENSION_META } from "./dimensions";
import { captureSite } from "./capture";
import {
  analyzeDimension,
  analyzeBrdCoverage,
  type Finding,
  type DimensionAnalysis,
  type CoverageAnalysis,
} from "./analyze";

interface DimensionScore {
  dimension: TestDimension;
  score: number;
  advisory: boolean;
}

function toFindingRows(findings: Finding[]) {
  return findings.map((f) => ({
    severity: f.severity,
    title: f.title.slice(0, 500),
    detail: f.detail,
    recommendation: f.recommendation ? f.recommendation : null,
    evidence: f.evidence ? f.evidence : null,
  }));
}

function buildSummary(overall: number, scores: DimensionScore[], criticalHigh: number): string {
  // Headline reflects the authoritative (non-advisory) dimensions when present.
  const core = scores.filter((s) => !s.advisory);
  const pool = core.length > 0 ? core : scores;
  const worst = [...pool].sort((a, b) => a.score - b.score)[0];
  const parts = [
    `Overall ${overall}/100 across ${scores.length} dimension${scores.length === 1 ? "" : "s"}.`,
  ];
  if (criticalHigh > 0) {
    parts.push(`${criticalHigh} critical/high finding${criticalHigh === 1 ? "" : "s"} to address.`);
  }
  if (worst) parts.push(`Weakest area: ${worst.dimension} (${worst.score}/100).`);
  return parts.join(" ");
}

// Run `fn` over `items` with at most `limit` in flight — bounds concurrent model
// calls so a multi-dimension run doesn't burst into provider rate limits.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Run an existing PENDING (or re-run) TestRun to completion. Self-contained: it
 * never throws — any failure (including the initial load / RUNNING update) is
 * recorded on the run as FAILED, so a background invocation can't leave a PENDING
 * zombie or an unhandled rejection.
 */
export async function executeRun(runId: string): Promise<void> {
  try {
    const run = await prisma.testRun.findUnique({
      where: { id: runId },
      include: { assessment: true },
    });
    if (!run || !run.assessment) {
      throw new Error("Run or its assessment not found");
    }
    const { assessment } = run;

    await prisma.testRun.update({
      where: { id: runId },
      data: { status: "RUNNING", startedAt: new Date() },
    });

    const capture = await captureSite(assessment.targetUrl);
    await prisma.testRun.update({ where: { id: runId }, data: { finalUrl: capture.finalUrl } });

    const selected = DIMENSION_ORDER.filter((d) => assessment.dimensions.includes(d));
    const scores: DimensionScore[] = [];
    const errors: string[] = [];
    let criticalHigh = 0;

    // Analyse all selected dimensions CONCURRENTLY (the dominant cost is the model
    // round-trips) so the whole run fits inside the serverless time budget. Each
    // dimension is isolated — one failure records a FAIL result and never discards
    // the others. Analysis (network) runs in parallel; DB writes are done after.
    type Outcome =
      | { dimension: TestDimension; kind: "coverage"; coverage: CoverageAnalysis }
      | { dimension: TestDimension; kind: "dim"; dim: DimensionAnalysis }
      | { dimension: TestDimension; kind: "error"; error: string };

    const analyses: Outcome[] = await mapLimit(selected, 3, async (dimension): Promise<Outcome> => {
      try {
        if (dimension === "BRD_COVERAGE") {
          return { dimension, kind: "coverage", coverage: await analyzeBrdCoverage(capture, assessment.brdText) };
        }
        return { dimension, kind: "dim", dim: await analyzeDimension(dimension, capture, assessment.brdText) };
      } catch (dimErr) {
        return { dimension, kind: "error", error: dimErr instanceof Error ? dimErr.message : "Analysis failed" };
      }
    });

    for (const a of analyses) {
      if (a.kind === "error") {
        errors.push(`${a.dimension}: ${a.error}`);
        await prisma.dimensionResult.create({
          data: {
            runId,
            dimension: a.dimension,
            score: null,
            status: "FAIL",
            summary: `Analysis failed: ${a.error}`.slice(0, 1000),
            findings: {
              create: [
                {
                  severity: "HIGH",
                  title: "Dimension could not be analysed",
                  detail: a.error.slice(0, 1000),
                  recommendation: "Re-run the test; if it persists, check the engine configuration.",
                },
              ],
            },
          },
        });
        continue;
      }

      if (a.kind === "coverage") {
        const result = a.coverage;
        await prisma.dimensionResult.create({
          data: {
            runId,
            dimension: a.dimension,
            score: result.score,
            status: result.status,
            summary: result.summary,
            findings: { create: toFindingRows(result.findings) },
          },
        });
        if (result.requirements.length > 0) {
          await prisma.requirementCoverage.createMany({
            data: result.requirements.map((r) => ({
              runId,
              requirement: r.requirement,
              status: r.status,
              evidence: r.evidence ? r.evidence : null,
            })),
          });
        }
        scores.push({ dimension: a.dimension, score: result.score, advisory: false });
        criticalHigh += result.findings.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH").length;
      } else {
        const result = a.dim;
        await prisma.dimensionResult.create({
          data: {
            runId,
            dimension: a.dimension,
            score: result.score,
            status: result.status,
            summary: result.summary,
            findings: { create: toFindingRows(result.findings) },
          },
        });
        scores.push({ dimension: a.dimension, score: result.score, advisory: DIMENSION_META[a.dimension].advisory });
        criticalHigh += result.findings.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH").length;
      }
    }

    // Every dimension failed -> the run as a whole failed.
    if (scores.length === 0) {
      throw new Error(
        errors.length > 0 ? `All dimensions failed. ${errors.join("; ")}` : "No dimensions produced a result"
      );
    }

    // Headline score: average the authoritative (non-advisory) dimensions; fall
    // back to advisory-only when that's all that was selected (ADR-016).
    const core = scores.filter((s) => !s.advisory);
    const pool = core.length > 0 ? core : scores;
    const overall = Math.round(pool.reduce((sum, s) => sum + s.score, 0) / pool.length);

    await prisma.testRun.update({
      where: { id: runId },
      data: {
        status: "COMPLETED",
        overallScore: overall,
        summary: buildSummary(overall, scores, criticalHigh),
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error during run";
    // Best-effort — if even this write fails (DB down), don't re-throw out of the
    // background task. A read-time reaper will eventually mark the stale run FAILED.
    await prisma.testRun
      .update({
        where: { id: runId },
        data: { status: "FAILED", error: message.slice(0, 2000), finishedAt: new Date() },
      })
      .catch(() => {});
  }
}
