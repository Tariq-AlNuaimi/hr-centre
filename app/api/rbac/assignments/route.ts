import { NextRequest } from "next/server";
import { withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, ok, readJsonBody } from "@/lib/api-response";
import { paginatedResponse, parsePagination } from "@/lib/pagination";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { createAssignment, listAssignments } from "@/lib/rbac/service";
import { assignmentBodySchema, assignmentFilterSchema } from "@/lib/validations/rbac";

/** Role assignments with a scope — blueprint §3 (AC-F3.2). Platform admins only. */

export const GET = withRateLimit(
  withAdminAuth(async (request: NextRequest) => {
    const pagination = parsePagination(request.nextUrl.searchParams);
    const filter = assignmentFilterSchema.safeParse({
      roleId: request.nextUrl.searchParams.get("roleId") ?? undefined,
      userId: request.nextUrl.searchParams.get("userId") ?? undefined,
    });
    if (!filter.success) return validationError(filter.error);
    const { rows, total } = await listAssignments(pagination, filter.data);
    return ok(paginatedResponse(rows, total, pagination));
  }),
  { id: "rbac-assignments-list", limit: 120, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAdminAuth(async (request: NextRequest, { session }) => {
    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = assignmentBodySchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    try {
      return created(await createAssignment(parsed.data, session.user.id));
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "rbac-write", limit: 30, windowMs: 60_000 },
);
