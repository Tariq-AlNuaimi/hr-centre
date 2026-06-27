import { prisma } from "@/lib/prisma";

// Minimal org-user read for the Settings user-management section (UI-SPEC D.10).
// Mutations reuse the existing /api/users + /api/users/[id] routes (admin-gated,
// orgId-scoped); this is just the RSC list read. Tenant-scoped + bounded.

export type OrgUserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  lastLoginAt: Date | null;
};

export async function listOrgUsers(orgId: string): Promise<OrgUserRow[]> {
  return prisma.user.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, email: true, name: true, role: true, lastLoginAt: true },
  });
}
