import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdminAuth, withManagerAuth } from "@/lib/api-helpers";
import { ok, err, notFound } from "@/lib/api-response";
import { updateRoleProfileSchema } from "@/lib/validations/roleProfile";
import {
  getRoleProfile,
  updateRoleProfile,
  maskScoringKeys,
  isEditable,
} from "@/lib/services/roleProfile";

// Read one profile (UI-SPEC D.4). Any staff role; SJT scoring keys are masked for
// non-admins server-side. Tenant-scoped (404 on cross-tenant id, no existence leak).
export const GET = withManagerAuth(async (_req: NextRequest, { params, session }) => {
  const orgId = session.user.orgId;
  if (!orgId) return err("No organization context", 400);

  const { id } = await params;
  const profile = await getRoleProfile(orgId, id);
  if (!profile) return notFound("Role profile");

  const isAdmin = session.user.role === "HR_ADMIN";
  return ok(maskScoringKeys(profile, isAdmin));
});

// Edit a DRAFT/IN_REVIEW profile (UI-SPEC D.3). Admin-only. APPROVED/ACTIVE/ARCHIVED
// versions are immutable — revising requires cloning a new version (409).
export const PUT = withAdminAuth(async (request: NextRequest, { params, session }) => {
  const orgId = session.user.orgId;
  if (!orgId) return err("No organization context", 400);

  const { id } = await params;
  const existing = await getRoleProfile(orgId, id);
  if (!existing) return notFound("Role profile");
  if (!isEditable(existing.status)) {
    return err("This version is locked — clone a new version to edit", 409);
  }

  const body = await request.json();
  const parsed = updateRoleProfileSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const updated = await updateRoleProfile(orgId, id, parsed.data);
  return ok(maskScoringKeys(updated, true));
});

// Soft-delete a profile (recycling-bin registered). Admin-only.
export const DELETE = withAdminAuth(async (_req: NextRequest, { params, session }) => {
  const orgId = session.user.orgId;
  if (!orgId) return err("No organization context", 400);

  const { id } = await params;
  const existing = await prisma.roleProfile.findFirst({
    where: { id, orgId },
    select: { id: true },
  });
  if (!existing) return notFound("Role profile");

  await prisma.roleProfile.delete({ where: { id } });
  return ok({ id, deleted: true });
});
