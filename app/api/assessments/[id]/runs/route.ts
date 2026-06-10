import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withEditorAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, created, notFound } from "@/lib/api-response";
import { executeRun } from "@/lib/testing/engine";

// A run can take a while (browser capture + several Claude calls). Give the function
// generous headroom; Vercel caps this at the plan limit (60s Hobby / 300s Pro). For
// heavier crawls, move to a durable background job (Inngest) per ADR-015.
export const maxDuration = 300;

// List runs for an assessment (any authenticated user).
export const GET = withAuth(async (_request: NextRequest, { params }) => {
  const { id } = await params;
  const runs = await prisma.testRun.findMany({
    where: { assessmentId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      overallScore: true,
      summary: true,
      createdAt: true,
      finishedAt: true,
    },
  });
  return ok(runs);
});

// Trigger a new run (ADMIN or EDITOR). Executes synchronously then returns the
// finished (or FAILED) run with its results. Rate-limited — runs cost API + browser
// credits.
export const POST = withRateLimit(
  withEditorAuth(async (_request: NextRequest, { params }) => {
    const { id } = await params;
    const assessment = await prisma.assessment.findUnique({ where: { id } });
    if (!assessment) return notFound("Assessment");

    const run = await prisma.testRun.create({
      data: { assessmentId: id, status: "PENDING" },
      select: { id: true },
    });

    // executeRun catches its own errors and marks the run FAILED — it never throws.
    await executeRun(run.id);

    const finished = await prisma.testRun.findUnique({
      where: { id: run.id },
      include: {
        dimensionResults: {
          orderBy: { createdAt: "asc" },
          include: { findings: { orderBy: { severity: "asc" } } },
        },
        requirements: { orderBy: { createdAt: "asc" } },
      },
    });

    return created(finished);
  }),
  { id: "assessment-run", limit: 10, windowMs: 60_000 }
);
