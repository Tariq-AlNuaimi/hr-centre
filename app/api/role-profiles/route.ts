import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdminAuth, withManagerAuth } from "@/lib/api-helpers";
import { ok, created, err } from "@/lib/api-response";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { createRoleProfileSchema } from "@/lib/validations/roleProfile";
import { listRoleProfiles, createRoleProfile } from "@/lib/services/roleProfile";
import { RoleProfileStatus } from "@/generated/prisma/client";

const VALID_STATUSES = Object.values(RoleProfileStatus) as string[];

// List role profiles (UI-SPEC D.2). Readable by any staff role (managers view
// profiles read-only); tenant-scoped + bounded.
export const GET = withManagerAuth(async (request: NextRequest, { session }) => {
  const orgId = session.user.orgId;
  if (!orgId) return err("No organization context", 400);

  const { searchParams } = request.nextUrl;
  const pagination = parsePagination(searchParams);

  const statusParam = searchParams.get("status");
  const status =
    statusParam && VALID_STATUSES.includes(statusParam)
      ? (statusParam as RoleProfileStatus)
      : undefined;

  const { data, total } = await listRoleProfiles(orgId, {
    skip: pagination.skip,
    take: pagination.take,
    status,
    roleFamilyId: searchParams.get("roleFamilyId") ?? undefined,
    search: searchParams.get("search") ?? undefined,
  });

  return ok(paginatedResponse(data, total, pagination));
});

// Create a new DRAFT profile (UI-SPEC D.3). Admin-only authoring.
export const POST = withAdminAuth(async (request: NextRequest, { session }) => {
  const orgId = session.user.orgId;
  if (!orgId) return err("No organization context", 400);

  const body = await request.json();
  const parsed = createRoleProfileSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }

  // The role family must exist in the caller's org (no cross-tenant family).
  const family = await prisma.roleFamily.findFirst({
    where: { id: parsed.data.roleFamilyId, orgId },
    select: { id: true },
  });
  if (!family) return err("Unknown role family", 400);

  const profile = await createRoleProfile(orgId, session.user.id, parsed.data);
  return created(profile);
});
