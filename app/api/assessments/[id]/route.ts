import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withEditorAuth } from "@/lib/api-helpers";
import { ok, err, notFound } from "@/lib/api-response";
import { updateAssessmentSchema } from "@/lib/validations/assessment";
import { reapStaleRuns } from "@/lib/testing/reap";

// Read one assessment (any authenticated user), with its run history.
export const GET = withAuth(async (_request: NextRequest, { params }) => {
  const { id } = await params;
  await reapStaleRuns(id); // mark any run killed past the time limit as FAILED
  const assessment = await prisma.assessment.findUnique({
    where: { id },
    include: {
      owner: { select: { name: true, email: true } },
      runs: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          overallScore: true,
          summary: true,
          createdAt: true,
          finishedAt: true,
        },
      },
    },
  });

  if (!assessment) return notFound("Assessment");
  return ok(assessment);
});

// Update an assessment (ADMIN or EDITOR).
export const PUT = withEditorAuth(async (request: NextRequest, { params }) => {
  const { id } = await params;
  const body = await request.json();
  const parsed = updateAssessmentSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const existing = await prisma.assessment.findUnique({ where: { id } });
  if (!existing) return notFound("Assessment");

  const assessment = await prisma.assessment.update({
    where: { id },
    data: parsed.data,
    select: { id: true, name: true, targetUrl: true, dimensions: true, updatedAt: true },
  });

  return ok(assessment);
});

// Soft-delete an assessment (ADMIN or EDITOR). The soft-delete extension rewrites
// this to a deletedAt update + audit record; runs cascade only on permanent delete
// from the recycling bin.
export const DELETE = withEditorAuth(async (_request: NextRequest, { params }) => {
  const { id } = await params;
  const existing = await prisma.assessment.findUnique({ where: { id } });
  if (!existing) return notFound("Assessment");

  await prisma.assessment.delete({ where: { id } });
  return ok({ id, deleted: true });
});
