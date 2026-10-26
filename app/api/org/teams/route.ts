import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, forbidden, ok, readJsonBody } from "@/lib/api-response";
import { paginatedResponse, parsePagination } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { createTeam } from "@/lib/org/teams";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { createTeamSchema, teamListQuerySchema } from "@/lib/validations/org";

/** Teams — blueprint §1 (F-a). Each team sits inside exactly one department. */

export const GET = withRateLimit(
  withAuth(async (request: NextRequest) => {
    const { searchParams } = request.nextUrl;
    const pagination = parsePagination(searchParams);
    const parsed = teamListQuerySchema.safeParse({
      departmentId: searchParams.get("departmentId") ?? undefined,
    });
    if (!parsed.success) return validationError(parsed.error);
    const where = parsed.data.departmentId ? { departmentId: parsed.data.departmentId } : {};

    const [teams, total] = await Promise.all([
      prisma.team.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          departmentId: true,
          department: {
            select: { id: true, name: true, entity: { select: { id: true, code: true } } },
          },
          _count: { select: { employees: { where: { deletedAt: null } } } },
        },
      }),
      prisma.team.count({ where }),
    ]);
    return ok(paginatedResponse(teams, total, pagination));
  }),
  { id: "org-teams-list", limit: 120, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!actor.capabilities.configure) return forbidden();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = createTeamSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    try {
      return created(await createTeam(parsed.data));
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "org-teams-write", limit: 30, windowMs: 60_000 },
);
