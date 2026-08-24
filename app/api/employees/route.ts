import { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, ok } from "@/lib/api-response";
import { paginatedResponse, parsePagination } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { employeeSelect, serializeEmployee } from "@/lib/pms/employee-select";
import { visibleEmployeeIds } from "@/lib/pms/org-tree";
import { employeeListQuerySchema } from "@/lib/validations/employee";

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
    });

    // An authenticated user with no employee record and no org-wide role sees
    // nothing. Returning an empty page rather than 403 is deliberate: the
    // directory exists, they are simply in none of it.
    if (visibleIds !== null && visibleIds.size === 0) {
      return ok(paginatedResponse([], 0, pagination));
    }

    const where: Prisma.EmployeeWhereInput = {
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
      ...(filters.roleTrack ? { roleTrack: filters.roleTrack } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { [sortField]: order },
        select: employeeSelect(actor),
      }),
      prisma.employee.count({ where }),
    ]);

    return ok(paginatedResponse(rows.map(serializeEmployee), total, pagination));
  }),
  { id: "pms-employees-list", limit: 120, windowMs: 60_000 },
);
