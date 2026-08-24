import { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { isHrSuperAdmin } from "@/lib/pms/permissions";

/**
 * Grant and revoke HR roles — spec §4.1, §4.3.
 *
 * This is the screen Phase 1 owed. Until it existed, the only way to hold
 * HR_SUPER_ADMIN was `bootstrapAdminEmployee` in `prisma/seed-pms.ts`, which
 * grants it from a BUILD STEP and refuses to run once real org data is present.
 * That was a deliberate prototype stopgap with a stated expiry; this is the
 * expiry. HR authority is now granted by a person, to a person, on the record,
 * through the audit trail.
 *
 * Super-Admin only, and deliberately narrower than `canRunCycle`: §4.1 gives
 * HRBP "runs the cycle org-wide" but marks Configures? as "No". Deciding who
 * else gets to see every salary in the company is configuration.
 */

const PMS_ROLES = ["HR_SUPER_ADMIN", "HRBP", "EXECUTIVE_VIEWER"] as const;

const updateRolesSchema = z.object({
  // §4.3 — roles are additive and merge "most access wins". The whole set is
  // sent, not a delta: a grant and a revoke in one request are the same
  // operation, and a delta API invites two clients to disagree about order.
  pmsRoles: z.array(z.enum(PMS_ROLES)).max(PMS_ROLES.length),
});

export const PUT = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);
    if (!isHrSuperAdmin(actor)) return forbidden();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = updateRolesSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const next = [...new Set(parsed.data.pmsRoles)];

    const target = await prisma.employee.findUnique({
      where: { id },
      select: { id: true, name: true, pmsRoles: true },
    });
    if (!target) return notFound("Employee");

    // You may not remove your own Super Admin. Not paternalism: HR_SUPER_ADMIN is
    // the ONLY role that can grant HR_SUPER_ADMIN, so the last one revoking
    // themselves leaves an organisation whose salary data nobody can administer
    // and whose only recovery is a database edit. Revoking someone ELSE is
    // allowed, including the last one — that is a decision with a person behind
    // it, which is exactly what this endpoint exists to record.
    if (
      target.id === actor.employeeId &&
      target.pmsRoles.includes("HR_SUPER_ADMIN") &&
      !next.includes("HR_SUPER_ADMIN")
    ) {
      return err(
        "You cannot remove your own HR Super Admin role. Ask another Super Admin to do it, " +
          "so the organisation is never left without one by accident.",
        409,
      );
    }

    const updated = await prisma.employee.update({
      where: { id },
      data: { pmsRoles: next },
      select: { id: true, name: true, email: true, pmsRoles: true },
    });

    return ok(updated);
  }),
  { id: "pms-roles-write", limit: 20, windowMs: 60_000 },
);
