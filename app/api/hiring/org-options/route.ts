import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden, ok } from "@/lib/api-response";
import { holdsAnywhere } from "@/lib/hiring/access";
import { hiringRoute } from "@/lib/hiring/route";
import { companyScope } from "@/lib/hiring/scope";
import { prisma } from "@/lib/prisma";

/** Companies and departments the actor may raise hiring for (form pickers). */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { actor }) => {
      if (!holdsAnywhere(actor, "hiring.view")) return forbidden();
      const scoped = companyScope(actor, "hiring.manage");
      const [entities, departments] = await Promise.all([
        prisma.orgEntity.findMany({
          where: { deletedAt: null },
          select: { id: true, code: true, name: true },
          orderBy: { name: "asc" },
          take: 50,
        }),
        prisma.department.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true, entityId: true, directorateId: true },
          orderBy: { name: "asc" },
          take: 2000,
        }),
      ]);
      return ok({
        entities,
        departments,
        manageableEntityIds: scoped === null ? entities.map((e) => e.id) : scoped,
      });
    }),
  ),
  { id: "hiring-org-options", limit: 120, windowMs: 60_000 },
);
