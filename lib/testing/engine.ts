// Vibe Inspector — run orchestrator (ADR-015).
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
import { analyzeDimension, analyzeBrdCoverage, type Finding } from "./analyze";

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

/**
 * Run an existing PENDING (or re-run) TestRun to completion. Idempotency is the
 * caller's concern — the route creates the run, then calls this once.
 */
export async function executeRun(runId: string): Promise<void> {
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

  try {
    const capture = await captureSite(assessment.targetUrl);
    await prisma.testRun.update({ where: { id: runId }, data: { finalUrl: capture.finalUrl } });

    const selected = DIMENSION_ORDER.filter((d) => assessment.dimensions.includes(d));
    const scores: DimensionScore[] = [];
    const errors: string[] = [];
    let criticalHigh = 0;

    // Each dimension is isolated: one dimension's failure (API error, truncated
    // output, schema mismatch) records a FAIL result and continues — it never
    // discards the dimensions already analysed.
    for (const dimension of selected) {
      try {
        if (dimension === "BRD_COVERAGE") {
          const result = await analyzeBrdCoverage(capture, assessment.brdText);
          await prisma.dimensionResult.create({
            data: {
              runId,
              dimension,
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
          scores.push({ dimension, score: result.score, advisory: false });
          criticalHigh += result.findings.filter(
            (f) => f.severity === "CRITICAL" || f.severity === "HIGH"
          ).length;
        } else {
          const result = await analyzeDimension(dimension, capture, assessment.brdText);
          await prisma.dimensionResult.create({
            data: {
              runId,
              dimension,
              score: result.score,
              status: result.status,
              summary: result.summary,
              findings: { create: toFindingRows(result.findings) },
            },
          });
          scores.push({ dimension, score: result.score, advisory: DIMENSION_META[dimension].advisory });
          criticalHigh += result.findings.filter(
            (f) => f.severity === "CRITICAL" || f.severity === "HIGH"
          ).length;
        }
      } catch (dimErr) {
        const msg = dimErr instanceof Error ? dimErr.message : "Analysis failed";
        errors.push(`${dimension}: ${msg}`);
        await prisma.dimensionResult.create({
          data: {
            runId,
            dimension,
            score: null,
            status: "FAIL",
            summary: `Analysis failed: ${msg}`.slice(0, 1000),
            findings: {
              create: [
                {
                  severity: "HIGH",
                  title: "Dimension could not be analysed",
                  detail: msg.slice(0, 1000),
                  recommendation: "Re-run the test; if it persists, check the engine configuration.",
                },
              ],
            },
          },
        });
      }
    }

    // Every dimension failed -> the run as a whole failed.
    if (scores.length === 0) {
      throw new Error(
        errors.length > 0 ? `All dimensions failed. ${errors.join("; ")}` : "No dimensions produced a result"
      );
    }

    // Headline score: average the authoritative (non-advisory) dimensions; fall
    // back to advisory-only when that's all that was selected (ADR-015).
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
    await prisma.testRun.update({
      where: { id: runId },
      data: { status: "FAILED", error: message.slice(0, 2000), finishedAt: new Date() },
    });
  }
}
