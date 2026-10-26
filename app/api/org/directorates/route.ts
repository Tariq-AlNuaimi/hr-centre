import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, forbidden, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { createDirectorate } from "@/lib/org/units";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { createDirectorateSchema } from "@/lib/validations/org";

/**
 * Directorates — blueprint §1 (F-a). The optional level between a company and
 * its departments; only Rihal has them today.
 *
 * Readable by any signed-in user (org structure, not personnel data — same
 * reasoning as /api/org/entities); writable by whoever may configure the org.
 */

export const GET = withRateLimit(
  withAuth(async () => {
    const directorates = await prisma.directorate.findMany({
      orderBy: [{ entity: { code: "asc" } }, { name: "asc" }],
      // Bounded: a handful per company is the real shape.
      take: 200,
      select: {
        id: true,
        name: true,
        entityId: true,
        entity: { select: { id: true, code: true, name: true } },
        _count: { select: { departments: { where: { deletedAt: null } } } },
      },
    });
    return ok(directorates);
  }),
  { id: "org-directorates-list", limit: 120, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!actor.capabilities.orgManage) return forbidden();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = createDirectorateSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    try {
      return created(await createDirectorate(parsed.data));
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "org-directorates-write", limit: 30, windowMs: 60_000 },
);
