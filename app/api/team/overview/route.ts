import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { resolveActor } from "@/lib/pms/actor";
import { teamOverview } from "@/lib/people/team-overview";

/**
 * The viewer's own team across modules (UX review R14,
 * docs/blueprints/ux-p1-team.md): reports by status, their joiner / mover /
 * leaver cases in flight, and the hiring requests the viewer owns. Keyed on
 * the viewer's own reporting line and requisitions — nobody else's team can be
 * asked for, so there is no id parameter to probe.
 */
export const GET = withRateLimit(
  withAuth(async (_request, { session }) => {
    const actor = await resolveActor(session);
    return ok(await teamOverview({ employeeId: actor.employeeId, userId: actor.userId }));
  }),
  { id: "team-overview", limit: 120, windowMs: 60_000 },
);
