import { NextRequest } from "next/server";
import { withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { resendInvitation } from "@/lib/services/invitation";

// Resend an invitation (UI-SPEC D.5). Rotates the token (old link dies) and
// re-emails. Admin-only; cross-tenant id → 404; STARTED/COMPLETED/REVOKED → 409.
export const POST = withRateLimit(
  withAdminAuth(async (request: NextRequest, { session, params }) => {
    const orgId = session.user.orgId;
    if (!orgId) return err("No organization context", 400);
    const { id } = await params;

    const baseUrl = process.env.AUTH_URL ?? request.nextUrl.origin;
    const res = await resendInvitation({ orgId, id, baseUrl, userId: session.user.id });
    if (res.status !== 200) return err(res.error, res.status);
    return ok({ result: res.result });
  }),
  { id: "invitation-resend", limit: 30, windowMs: 60_000 }
);
