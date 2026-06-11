import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/api-helpers";
import { err, notFound } from "@/lib/api-response";
import { buildReportHtml } from "@/lib/testing/report-html";
import { renderHtmlToPdf } from "@/lib/testing/pdf";

// Rendering goes through the Browserbase browser (printToPDF), so allow headroom.
export const maxDuration = 120;

// Download a run's report as a shareable PDF (any authenticated user).
export const GET = withAuth(async (_request: NextRequest, { params }) => {
  const { id } = await params;
  const run = await prisma.testRun.findUnique({
    where: { id },
    include: {
      assessment: { select: { name: true, targetUrl: true } },
      dimensionResults: {
        orderBy: { createdAt: "asc" },
        include: { findings: { orderBy: { severity: "asc" } } },
      },
      requirements: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!run) return notFound("Run");
  if (run.status !== "COMPLETED") {
    return err("The report PDF is available once the run has completed.", 409);
  }

  const html = buildReportHtml({
    overallScore: run.overallScore,
    summary: run.summary,
    finalUrl: run.finalUrl,
    createdAt: run.createdAt,
    assessment: run.assessment,
    dimensionResults: run.dimensionResults.map((d) => ({
      dimension: d.dimension,
      score: d.score,
      status: d.status,
      summary: d.summary,
      findings: d.findings.map((f) => ({
        severity: f.severity,
        title: f.title,
        detail: f.detail,
        recommendation: f.recommendation,
        evidence: f.evidence,
      })),
    })),
    requirements: run.requirements.map((r) => ({
      requirement: r.requirement,
      status: r.status,
      evidence: r.evidence,
    })),
  });

  let pdf: Buffer;
  try {
    pdf = await renderHtmlToPdf(html);
  } catch (e) {
    return err(e instanceof Error ? e.message : "Could not render the PDF", 502);
  }

  const safeName = (run.assessment?.name ?? "report").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="vibe-inspector-${safeName}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
});
