import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { revokeInvite } from "@/lib/hiring/agency-invite-admin";
import { hiringRoute } from "@/lib/hiring/route";

/** Revoke an invite (idempotent). Out of scope = 404. */
export const DELETE = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const r = await revokeInvite(actor, id);
      return r ? ok(r) : notFound("Invite");
    }),
  ),
  { id: "hiring-agency-write", limit: 30, windowMs: 60_000 },
);
