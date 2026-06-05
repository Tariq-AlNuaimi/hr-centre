// React Server Component (no "use client"). The template's canonical RSC
// data-fetching example: it runs the auth gate + Prisma reads on the server,
// then hands serializable data to a CLIENT island (`DashboardContent`).
//
// IMPORTANT: a Server Component must NOT render Ant Design components directly
// (Ant is client-only; `Typography.Title` etc. resolve to `undefined` across the
// RSC boundary, and Table `render` callbacks / dynamic{ssr:false} Chart can't
// cross it either). So this RSC renders no JSX of its own -- all UI lives in the
// client island. See docs/recipes/perf/1-rsc-list-reads.md.

import { auth } from "@/lib/auth";
import { prisma, prismaUnfiltered } from "@/lib/prisma";
import { RECYCLABLE_ENTITY_TYPES } from "@/lib/prisma/recyclable";
import {
  DashboardContent,
  type DashboardData,
  type RecentAudit,
} from "@/components/dashboard/DashboardContent";

// Recompute on every request -- this page reflects live counts.
export const dynamic = "force-dynamic";

async function getDashboardData(): Promise<DashboardData> {
  // total users + per-role breakdown (soft-delete filtered via `prisma`)
  const [totalUsers, usersByRole] = await Promise.all([
    prisma.user.count(),
    // NOTE: the soft-delete extension does NOT intercept groupBy/aggregate, so
    // filter deletedAt explicitly here -- otherwise the role breakdown would
    // include soft-deleted users while totalUsers (count) excludes them.
    prisma.user.groupBy({
      by: ["role"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  // Count soft-deleted records across every recyclable entity. `prismaUnfiltered`
  // bypasses the soft-delete filter so deletedAt rows are visible.
  const deletedCounts = await Promise.all(
    Object.keys(RECYCLABLE_ENTITY_TYPES).map((entityType) => {
      const accessor = entityType[0].toLowerCase() + entityType.slice(1);
      const delegate = (
        prismaUnfiltered as unknown as Record<
          string,
          { count: (a: { where: { deletedAt: { not: null } } }) => Promise<number> }
        >
      )[accessor];
      return delegate.count({ where: { deletedAt: { not: null } } });
    })
  );
  const softDeletedTotal = deletedCounts.reduce((a, b) => a + b, 0);

  // 5 most recent audit-log entries (AuditLog is never soft-deleted).
  const recentAuditRows = await prisma.auditLog.findMany({
    orderBy: { timestamp: "desc" },
    take: 5,
    include: { user: { select: { name: true } } },
  });

  const recentAudit: RecentAudit[] = recentAuditRows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    userName: row.user?.name ?? null,
    timestamp: row.timestamp.toISOString(),
  }));

  return {
    totalUsers,
    roleDistribution: usersByRole.map((g) => ({
      name: g.role,
      value: g._count._all,
    })),
    softDeletedTotal,
    recentAudit,
  };
}

export default async function DashboardPage() {
  // Auth gate stays server-side so admin data never reaches a non-admin client.
  const session = await auth();
  const isAdmin = session?.user?.role === "ADMIN";
  const data = isAdmin ? await getDashboardData() : null;

  return <DashboardContent isAdmin={isAdmin} data={data} />;
}
