import type { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

/**
 * The grade catalogue's codes for one company (its own grades and the group-wide
 * ones) — the employee form's grade picker (ADR-103). Codes and names are org
 * structure, readable by any signed-in user like the company list; pay bands
 * are never returned here.
 */
const querySchema = z.object({ entityId: z.string().trim().min(1).max(64) });

export const GET = withRateLimit(
  withAuth(async (req: NextRequest) => {
    const q = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!q.success) return err("Choose a company", 400);
    const grades = await prisma.grade.findMany({
      where: { OR: [{ entityId: q.data.entityId }, { entityId: null }] },
      orderBy: [{ order: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, entityId: true },
      take: 200,
    });
    return ok(grades);
  }),
  { id: "org-grades-list", limit: 120, windowMs: 60_000 },
);
