import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, forbidden, ok } from "@/lib/api-response";
import { paginatedResponse, parsePagination } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { createDepartmentSchema } from "@/lib/validations/employee";

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
          entity: { select: { id: true, code: true, name: true } },
          _count: { select: { employees: true } },
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
    if (!actor.capabilities.configure) return forbidden();

    const body = await request.json();
    const parsed = createDepartmentSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { name, entityId } = parsed.data;

    const entity = await prisma.orgEntity.findUnique({
      where: { id: entityId },
      select: { id: true, code: true },
    });
    if (!entity) return err("entityId: that entity does not exist");

    const clash = await prisma.department.findUnique({
      where: { entityId_name: { entityId, name } },
      select: { id: true },
    });
    if (clash) {
      return err(`${entity.code} already has a department called "${name}"`, 409);
    }

    const department = await prisma.department.create({
      data: { name, entityId },
      select: {
        id: true,
        name: true,
        entityId: true,
        entity: { select: { id: true, code: true, name: true } },
      },
    });
    return created(department);
  }),
  { id: "pms-departments-write", limit: 30, windowMs: 60_000 },
);
