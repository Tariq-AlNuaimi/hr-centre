import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withEditorAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, created, err } from "@/lib/api-response";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { createAssessmentSchema } from "@/lib/validations/assessment";
import type { Prisma } from "@/generated/prisma/client";

// List assessments (any authenticated user). Includes a run count + the latest run
// so the table can show last-run status/score at a glance.
export const GET = withAuth(async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const pagination = parsePagination(searchParams);
  const search = searchParams.get("search") ?? undefined;

  const where: Prisma.AssessmentWhereInput = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { targetUrl: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [data, total] = await Promise.all([
    prisma.assessment.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        targetUrl: true,
        dimensions: true,
        createdAt: true,
        _count: { select: { runs: true } },
        runs: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, overallScore: true, createdAt: true },
        },
      },
    }),
    prisma.assessment.count({ where }),
  ]);

  return ok(paginatedResponse(data, total, pagination));
});

// Create an assessment (ADMIN or EDITOR; VIEWER is read-only). Rate-limited per IP.
export const POST = withRateLimit(
  withEditorAuth(async (request: NextRequest, { session }) => {
    const body = await request.json();
    const parsed = createAssessmentSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "));
    }

    const assessment = await prisma.assessment.create({
      data: { ...parsed.data, ownerId: session.user.id },
      select: { id: true, name: true, targetUrl: true, dimensions: true, createdAt: true },
    });

    return created(assessment);
  }),
  { id: "assessment-create", limit: 30, windowMs: 60_000 }
);
