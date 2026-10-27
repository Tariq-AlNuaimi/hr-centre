import { NextRequest } from "next/server";
import { withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { validationError } from "@/lib/org/http";
import { effectiveAccess } from "@/lib/rbac/service";
import { effectiveAccessQuerySchema } from "@/lib/validations/rbac";

/**
 * "View access as…" (UX P1 R12, docs/blueprints/ux-p1-roles.md): one person's
 * effective permissions and the scopes they hold them at. Platform admins
 * only, like the rest of the role builder (HR cannot inspect or change its own
 * powers). Read-only; returns role names, permission codes and unit names.
 */
export const GET = withRateLimit(
  withAdminAuth(async (request: NextRequest) => {
    const parsed = effectiveAccessQuerySchema.safeParse({
      userId: request.nextUrl.searchParams.get("userId") ?? undefined,
    });
    if (!parsed.success) return validationError(parsed.error);
    return ok(await effectiveAccess(parsed.data.userId));
  }),
  { id: "rbac-effective", limit: 120, windowMs: 60_000 },
);
