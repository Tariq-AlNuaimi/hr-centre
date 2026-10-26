import { NextRequest } from "next/server";
import { withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, ok, readJsonBody } from "@/lib/api-response";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { createRole, listRoles } from "@/lib/rbac/service";
import { roleBodySchema } from "@/lib/validations/rbac";

/**
 * Role builder — blueprint §3 (F-c). PLATFORM ADMINS ONLY (`withAdminAuth`):
 * HR cannot change its own powers (AC-F3.3 — everyone else gets 403).
 */

export const GET = withRateLimit(
  withAdminAuth(async () => ok(await listRoles())),
  { id: "rbac-roles-list", limit: 120, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAdminAuth(async (request: NextRequest) => {
    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = roleBodySchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    try {
      return created(await createRole(parsed.data));
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "rbac-write", limit: 30, windowMs: 60_000 },
);
