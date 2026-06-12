import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withEditorAuth } from "@/lib/api-helpers";
import { ok, err, notFound } from "@/lib/api-response";
import { updateAssessmentSchema } from "@/lib/validations/assessment";
import { mergeCredentialRows, credentialSummaries } from "@/lib/testing/credentials";
import { reapStaleRuns } from "@/lib/testing/reap";

// Read one assessment (any authenticated user), with its run history.
export const GET = withAuth(async (_request: NextRequest, { params }) => {
  const { id } = await params;
  await reapStaleRuns(id); // mark any run killed past the time limit as FAILED
  const assessment = await prisma.assessment.findUnique({
    where: { id },
    include: {
      owner: { select: { name: true, email: true } },
      credentials: true,
      runs: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          role: true,
          overallScore: true,
          summary: true,
          createdAt: true,
          finishedAt: true,
        },
      },
    },
  });

  if (!assessment) return notFound("Assessment");
  // Never return credential secrets — only a secret-free summary.
  const { credentials, ...rest } = assessment;
  return ok({ ...rest, credentials: credentialSummaries(credentials) });
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

  const { credentials, authMode, loginUrl, ...rest } = parsed.data;
  // Auth fields are replaced as a unit when authMode is provided; otherwise left as-is.
  const authData =
    authMode === undefined
      ? {}
      : {
          authMode,
          loginUrl: authMode === "FORM" ? loginUrl?.trim() || null : null,
        };

  const assessment = await prisma.$transaction(async (tx) => {
    if (authMode !== undefined) {
      // Re-shape the credential set, PRESERVING stored secrets where the edit left
      // the password/cookie blank (they're never sent back to the client).
      const existingCreds = await tx.assessmentCredential.findMany({ where: { assessmentId: id } });
      await tx.assessmentCredential.deleteMany({ where: { assessmentId: id } });
      const rows = mergeCredentialRows(credentials, authMode, existingCreds);
      if (rows.length > 0) {
        await tx.assessmentCredential.createMany({
          data: rows.map((r) => ({ ...r, assessmentId: id })),
        });
      }
    }
    return tx.assessment.update({
      where: { id },
      data: { ...rest, ...authData },
      select: { id: true, name: true, targetUrl: true, dimensions: true, updatedAt: true },
    });
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
