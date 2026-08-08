// React Server Component (no "use client"). The template's canonical RSC
// data-fetching example: it runs the auth gate + Prisma reads on the server,
// then hands serializable data to a CLIENT island (`DashboardContent`).
//
// IMPORTANT: a Server Component must NOT render Ant Design components directly
// (Ant is client-only; `Typography.Title` etc. resolve to `undefined` across the
// RSC boundary, and Table `render` callbacks / dynamic{ssr:false} Chart can't
// cross it either). So this RSC renders no JSX of its own -- all UI lives in the
// client island. See docs/recipes/perf/1-rsc-list-reads.md.

import { unstable_cache } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma, prismaUnfiltered } from "@/lib/prisma";
import {
  RECYCLABLE_ENTITY_TYPES,
  recyclableAccessor,
  recyclableClient,
} from "@/lib/prisma/recyclable";
import {
  DashboardContent,
  type DashboardData,
  type RecentAudit,
} from "@/components/dashboard/DashboardContent";

// The page stays dynamic for the per-request auth gate; the heavy aggregate
// below is what's cached, not the page.
export const dynamic = "force-dynamic";

// Cache the 8-query dashboard aggregate for a short window (CP-PO6). The counts
// are GLOBAL (not per-user) and the dashboard tolerates ~30s staleness, so every
// admin page-load no longer recomputes them. unstable_cache reads no
// cookies/headers (the auth gate runs in the page, outside this function).
const getDashboardData = unstable_cache(getDashboardDataUncached, ["dashboard-data"], {
  revalidate: 30,
  tags: ["dashboard-data"],
});

async function getDashboardDataUncached(): Promise<DashboardData> {
  // total users + per-role breakdown (soft-delete filtered via `prisma`)
  const [totalUsers, usersByRole] = await Promise.all([
    prisma.user.count(),
    // The soft-delete extension DOES intercept groupBy/aggregate (it injects
    // `deletedAt: null` through the same applySoftDeleteFilter as every read
    // hook), so this explicit `where` is redundant defense-in-depth -- kept so
    // the intent is visible at the call site and locked by the groupBy case in
    // tests/integration/audit-softdelete.test.ts.
    prisma.user.groupBy({
      by: ["role"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  // Count soft-deleted records across every recyclable entity. `prismaUnfiltered`
  // bypasses the soft-delete filter so deletedAt rows are visible.
  const recyclable = recyclableClient(prismaUnfiltered);
  const deletedCounts = await Promise.all(
    Object.keys(RECYCLABLE_ENTITY_TYPES).map((entityType) => {
      // recyclableAccessor() is the single source of truth for the entityType ->
      // delegate-name mapping (and validates against the allowlist). Keys here
      // come from RECYCLABLE_ENTITY_TYPES, so the accessor is always non-null.
      const accessor = recyclableAccessor(entityType)!;
      return recyclable[accessor].count({ where: { deletedAt: { not: null } } });
    }),
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

  // Real 14-day new-user series for the Total-users sparkline + trend. Honest
  // data only: 14 bounded COUNT queries (no row transfer, no N-per-row), one per
  // UTC-day bucket, run in parallel and cached with the rest of the aggregate.
  // With the seed's single admin the series is near-flat — it comes alive as a
  // fork gains users, which is the point (no fabricated demo numbers).
  const dayMs = 86_400_000;
  const now = new Date();
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const newUsers14d = await Promise.all(
    Array.from({ length: 14 }, (_, i) => {
      const from = new Date(startOfToday - (13 - i) * dayMs);
      const to = new Date(from.getTime() + dayMs);
      return prisma.user.count({ where: { createdAt: { gte: from, lt: to } } });
    }),
  );
  const last7 = newUsers14d.slice(7).reduce((a, b) => a + b, 0);
  const prior7 = newUsers14d.slice(0, 7).reduce((a, b) => a + b, 0);
  const usersTrend =
    prior7 === 0
      ? last7 > 0
        ? { value: 100, direction: "up" as const }
        : undefined
      : {
          value: Math.round(((last7 - prior7) / prior7) * 100),
          direction: last7 >= prior7 ? ("up" as const) : ("down" as const),
        };

  return {
    totalUsers,
    roleDistribution: usersByRole.map((g) => ({
      name: g.role,
      value: g._count._all,
    })),
    softDeletedTotal,
    recentAudit,
    newUsers14d,
    usersTrend,
  };
}

export default async function DashboardPage() {
  // Auth gate stays server-side so admin data never reaches a non-admin client.
  const session = await auth();
  const isAdmin = session?.user?.role === "ADMIN";
  const data = isAdmin ? await getDashboardData() : null;

  return <DashboardContent isAdmin={isAdmin} data={data} />;
}
