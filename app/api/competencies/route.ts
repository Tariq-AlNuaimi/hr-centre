import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

/**
 * The shared competency catalogue (ADR-097, ADR-103) — names, categories and
 * definitions, for pickers outside Hiring (Performance 360 questions). The
 * framework is organisational vocabulary, readable by any signed-in user;
 * Hiring's library edits it.
 */
export const GET = withRateLimit(
  withAuth(async () => {
    const rows = await prisma.competency.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: { id: true, name: true, category: true, definition: true },
      take: 500,
    });
    return ok(rows);
  }),
  { id: "competencies-list", limit: 120, windowMs: 60_000 },
);
