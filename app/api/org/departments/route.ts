import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, forbidden, ok, readJsonBody } from "@/lib/api-response";
import { paginatedResponse, parsePagination } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { createOrgDepartment } from "@/lib/org/units";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { createOrgDepartmentSchema } from "@/lib/validations/org";

/**
 * Departments — spec §1.2.
 *
 * "Departments are unique to their entity (e.g. 'Rihal Marketing', 'TP Sales',
 * 'CL Sales' are distinct departments)." The composite unique on
 * (entityId, name) is what enforces that; this route turns the constraint into
 * a readable message.
 *
 * Central/shared-service functions (HR, Finance, Admin, IT) exist only under
 * Rihal (§1.2) — that is a seeding fact, not something to enforce here: an
 * organization that opens a TP finance team should not need a code change.
 */

export const GET = withRateLimit(
  withAuth(async (request: NextRequest) => {
    const { searchParams } = request.nextUrl;
    const pagination = parsePagination(searchParams);
    const entityId = searchParams.get("entityId") ?? undefined;

    const where = entityId ? { entityId } : {};

    const [departments, total] = await Promise.all([
      prisma.department.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: [{ entity: { code: "asc" } }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          entityId: true,
          directorateId: true,
          entity: { select: { id: true, code: true, name: true } },
          directorate: { select: { id: true, name: true } },
          _count: {
            select: {
              employees: { where: { deletedAt: null } },
              teams: { where: { deletedAt: null } },
            },
          },
        },
      }),
      prisma.department.count({ where }),
    ]);

    return ok(paginatedResponse(departments, total, pagination));
  }),
  { id: "pms-departments-list", limit: 120, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!actor.capabilities.orgManage) return forbidden();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = createOrgDepartmentSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    // F-a: placement under an optional directorate, same-company rule and the
    // name clash all live in the org service, shared with PATCH.
    try {
      return created(await createOrgDepartment(parsed.data));
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "pms-departments-write", limit: 30, windowMs: 60_000 },
);
