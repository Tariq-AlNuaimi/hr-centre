import { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, forbidden, ok, readJsonBody } from "@/lib/api-response";
import { paginatedResponse, parsePagination } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/core/actor";
import { employeeSelect, serializeEmployee } from "@/lib/core/employee-select";
import { visibleEmployeeIds } from "@/lib/pms/org-tree";
import { employeeListQuerySchema } from "@/lib/validations/employee";
import { addEmployeeSchema, recordFromBody } from "@/lib/validations/people";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { recordFieldsTouched } from "@/lib/people/record";
import { createEmployeeFromForm } from "@/lib/people/service";
import { actorCan } from "@/lib/core/permissions";
import { subjectForPlacement } from "@/lib/rbac/resolve";

/**
 * The employee directory — spec §4.2 (hierarchical visibility) and §4.5
 * (field-level compensation confidentiality).
 *
 * Two independent access rules apply to every response and both are enforced
 * here, in the query, not in the component that renders it:
 *
 *   WHICH ROWS  — org-wide for HR and executives; own subtree plus self for a
 *                 manager; own record only for everyone else.
 *   WHICH COLUMNS — `basicSalary` is selected only when the actor is entitled
 *                 to it, so an unauthorised payload has nothing to leak.
 */

// Allowlist: prevents a raw column name reaching orderBy via ?sort=.
const SORTABLE_COLUMNS = ["name", "odooId", "roleTrack", "status", "createdAt"] as const;
type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);

    const { searchParams } = request.nextUrl;
    const pagination = parsePagination(searchParams);

    const parsed = employeeListQuerySchema.safeParse({
      search: searchParams.get("search") ?? undefined,
      entityId: searchParams.get("entityId") ?? undefined,
      departmentId: searchParams.get("departmentId") ?? undefined,
      directorateId: searchParams.get("directorateId") ?? undefined,
      teamId: searchParams.get("teamId") ?? undefined,
      managerId: searchParams.get("managerId") ?? undefined,
      roleTrack: searchParams.get("roleTrack") ?? undefined,
      status: searchParams.get("status") ?? undefined,
    });
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "));
    }
    const filters = parsed.data;

    const sortParam = searchParams.get("sort");
    const sortField: SortableColumn =
      sortParam && (SORTABLE_COLUMNS as readonly string[]).includes(sortParam)
        ? (sortParam as SortableColumn)
        : "name";
    const order: "asc" | "desc" = searchParams.get("order") === "desc" ? "desc" : "asc";

    // §4.2 — one recursive walk, not one query per level. `null` means org-wide
    // (no id filter), which is why the walk is not paid for by HR at all.
    const visibleIds = await visibleEmployeeIds({
      employeeId: actor.employeeId,
      orgWide: actor.capabilities.orgWide,
      scopeMembers: actor.scopeMembers,
    });

    // An authenticated user with no employee record and no org-wide role sees
    // nothing. Returning an empty page rather than 403 is deliberate: the
    // directory exists, they are simply in none of it.
    if (visibleIds !== null && visibleIds.size === 0) {
      return ok({ ...paginatedResponse([], 0, pagination), statusCounts: {} });
    }

    // Everything but the status filter: the status chips count within it.
    const scoped: Prisma.EmployeeWhereInput = {
      ...(visibleIds !== null ? { id: { in: [...visibleIds] } } : {}),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: "insensitive" as const } },
              { email: { contains: filters.search, mode: "insensitive" as const } },
              { odooId: { contains: filters.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(filters.entityId ? { entityId: filters.entityId } : {}),
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(filters.directorateId ? { department: { directorateId: filters.directorateId } } : {}),
      ...(filters.teamId ? { teamId: filters.teamId } : {}),
      ...(filters.managerId ? { managerId: filters.managerId } : {}),
      ...(filters.roleTrack ? { roleTrack: filters.roleTrack } : {}),
    };
    const where: Prisma.EmployeeWhereInput = {
      ...scoped,
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [rows, total, byStatus] = await Promise.all([
      prisma.employee.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { [sortField]: order },
        select: employeeSelect(actor),
      }),
      prisma.employee.count({ where }),
      // One grouped count (≤ 3 rows), not a query per status.
      prisma.employee.groupBy({ by: ["status"], where: scoped, _count: { _all: true } }),
    ]);
    const statusCounts = Object.fromEntries(byStatus.map((g) => [g.status, g._count._all]));

    return ok({
      ...paginatedResponse(rows.map(serializeEmployee), total, pagination),
      statusCounts,
    });
  }),
  { id: "pms-employees-list", limit: 120, windowMs: 60_000 },
);

/**
 * HR Centre F-b — Add employee (blueprint §5 "typing"). The second way in after
 * the import, through the same writer (AC-F5.2). Writing personal details or ID
 * documents additionally needs the permission to SEE them: nobody may set a
 * value they are not allowed to read back.
 */
export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!actor.capabilities.peopleEdit) return forbidden();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = addEmployeeSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    // F-c — the new person must land inside the actor's people.edit scope, and
    // salary / personal / ID fields need their own permission there.
    const { employee } = parsed.data;
    const subject = await subjectForPlacement(employee.entityId, employee.departmentId);
    if (!actorCan(actor, "people.edit", subject)) return forbidden();
    if (employee.basicSalary !== null && !actorCan(actor, "people.viewSalary", subject)) {
      return forbidden();
    }
    const record = recordFromBody(parsed.data.record);
    const touched = recordFieldsTouched(record);
    if (touched.personal && !actorCan(actor, "people.viewPersonal", subject)) return forbidden();
    if (touched.idDocuments && !actorCan(actor, "people.viewIdDocuments", subject)) {
      return forbidden();
    }

    try {
      return created(await createEmployeeFromForm(parsed.data.employee, record));
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "pms-employee-write", limit: 30, windowMs: 60_000 },
);
