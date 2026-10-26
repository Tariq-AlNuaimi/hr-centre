import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { holdsAnywhere, isHiringAdmin } from "@/lib/hiring/access";
import { hiringRoute } from "@/lib/hiring/route";
import { PERMISSIONS } from "@/lib/rbac/catalogue";

/**
 * The signed-in user's hiring affordances — which hiring permissions they hold
 * ANYWHERE. Drives the nav and buttons only; every route re-checks in scope.
 */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { actor }) =>
      ok({
        userId: actor.userId,
        isAdmin: isHiringAdmin(actor),
        permissions: PERMISSIONS.filter((p) => p.module === "hiring")
          .map((p) => p.code)
          .filter((code) => holdsAnywhere(actor, code)),
      }),
    ),
  ),
  { id: "hiring-me", limit: 240, windowMs: 60_000 },
);
