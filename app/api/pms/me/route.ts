import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { resolveActor } from "@/lib/pms/actor";

/**
 * The caller's own PMS identity and capabilities — spec §4.4.
 *
 * "Every user's interface separates My Tasks (personal action space) from
 * Oversight (view space)… Driven by assignment, not hierarchy or role name."
 * The chrome cannot make that split without knowing what the viewer is, and PMS
 * authority lives on the `Employee` record rather than in the session (ADR-065),
 * so it is served here rather than embedded in the JWT.
 *
 * Deliberately NOT added to the session token: PMS roles change when HR edits an
 * employee, and a role baked into a JWT would keep granting access until the
 * token expired. A short cached fetch reflects a revocation on the next request.
 *
 * Returns capabilities, never the underlying data they gate — no salary, no
 * employee list. It is safe for any authenticated user to ask what they
 * themselves can do.
 */
export const GET = withRateLimit(
  withAuth(async (_request, { session }) => {
    const actor = await resolveActor(session);
    return ok({
      employeeId: actor.employeeId,
      employeeName: actor.employeeName,
      entityId: actor.entityId,
      departmentId: actor.departmentId,
      pmsRoles: actor.pmsRoles,
      capabilities: actor.capabilities,
    });
  }),
  { id: "pms-me", limit: 240, windowMs: 60_000 },
);
