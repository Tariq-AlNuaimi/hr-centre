import { NextRequest } from "next/server";
import { withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { ruleErrorResponse } from "@/lib/org/http";
import { removeAssignment } from "@/lib/rbac/service";

/**
 * Remove one assignment. Platform admins only; refused if it would leave nobody
 * able to manage HR access (lib/rbac/guards.ts).
 */
export const DELETE = withRateLimit(
  withAdminAuth(async (_request: NextRequest, { params }) => {
    const { id } = await params;
    try {
      await removeAssignment(id);
      return ok({ id, removed: true });
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "rbac-write", limit: 30, windowMs: 60_000 },
);
