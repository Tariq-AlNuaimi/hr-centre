import { NextRequest } from "next/server";
import { withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { revokeInvitation } from "@/lib/services/invitation";

// Revoke an invitation (UI-SPEC D.5). Sets REVOKED → the candidate runner maps it
// to a 403. Admin-only; cross-tenant id → 404; COMPLETED/already-REVOKED → 409.
export const POST = withRateLimit(
  withAdminAuth(async (_request: NextRequest, { session, params }) => {
    const orgId = session.user.orgId;
    if (!orgId) return err("No organization context", 400);
    const { id } = await params;

    const res = await revokeInvitation({ orgId, id });
    if (res.status !== 200) return err(res.error, res.status);
    return ok({ revoked: true });
  }),
  { id: "invitation-revoke", limit: 30, windowMs: 60_000 }
);
