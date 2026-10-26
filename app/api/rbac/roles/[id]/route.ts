import { NextRequest } from "next/server";
import { withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { err, ok, readJsonBody } from "@/lib/api-response";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { deleteRole, updateRole } from "@/lib/rbac/service";
import { roleBodySchema } from "@/lib/validations/rbac";

/** Edit / delete one role. Platform admins only. Delete is refused while assigned. */

export const PATCH = withRateLimit(
  withAdminAuth(async (request: NextRequest, { params }) => {
    const { id } = await params;
    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = roleBodySchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    try {
      return ok(await updateRole(id, parsed.data));
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "rbac-write", limit: 30, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAdminAuth(async (_request: NextRequest, { params }) => {
    const { id } = await params;
    try {
      await deleteRole(id);
      return ok({ id, deleted: true });
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "rbac-write", limit: 30, windowMs: 60_000 },
);
