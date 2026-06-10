import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/api-helpers";
import { ok, notFound } from "@/lib/api-response";

// Read a single run with its full report (any authenticated user).
export const GET = withAuth(async (_request: NextRequest, { params }) => {
  const { id } = await params;
  const run = await prisma.testRun.findUnique({
    where: { id },
    include: {
      assessment: { select: { id: true, name: true, targetUrl: true } },
      dimensionResults: {
        orderBy: { createdAt: "asc" },
        include: { findings: { orderBy: { severity: "asc" } } },
      },
      requirements: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!run) return notFound("Run");
  return ok(run);
});
