"use client";

// Client island for the dashboard. The page itself is a React Server Component
// (it does the auth gate + Prisma reads on the server), but the interactive
// pieces here -- the Chart (loaded via `next/dynamic { ssr:false }`) and the
// DataTable with `render` callbacks -- CANNOT live in a Server Component
// (functions/ssr:false components can't cross the RSC->client boundary). So the
// RSC passes serializable data down to this client component, which renders it.
// This is the canonical RSC + client-island split (see docs/recipes/perf/1-rsc-list-reads.md).

import type { ColumnsType } from "antd/es/table";
import { useTranslations } from "next-intl";
import { Chart } from "@/components/shared/Chart";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { SectionCard } from "@/components/shared/SectionCard";
import { DataTable } from "@/components/shared/DataTable";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { BadgeProps } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";

export interface RecentAudit {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userName: string | null;
  timestamp: string;
}

export interface DashboardData {
  totalUsers: number;
  roleDistribution: { name: string; value: number }[];
  softDeletedTotal: number;
  recentAudit: RecentAudit[];
}

interface DashboardContentProps {
  isAdmin: boolean;
  data: DashboardData | null;
}

const ACTION_VARIANTS: Record<string, BadgeProps["variant"]> = {
  CREATE: "success",
  UPDATE: "brand",
  DELETE: "danger",
  RESTORE: "warning",
};

function UserIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function DashboardContent({ isAdmin, data }: DashboardContentProps) {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tAudit = useTranslations("auditLog");
  const tDash = useTranslations("dashboard");

  // Non-admin (or no data): just the welcome card. Admin data is gated server-side.
  if (!isAdmin || !data) {
    return (
      <>
        <PageHeader title={t("home")} />
        <Card>
          <CardContent className="p-6">{tDash("welcome")}</CardContent>
        </Card>
      </>
    );
  }

  const { totalUsers, roleDistribution, softDeletedTotal, recentAudit } = data;

  const recentColumns: ColumnsType<RecentAudit> = [
    {
      title: tAudit("action"),
      dataIndex: "action",
      key: "action",
      render: (val: string) => (
        <Badge variant={ACTION_VARIANTS[val] ?? "default"}>{val}</Badge>
      ),
    },
    { title: tAudit("entity"), dataIndex: "entityType", key: "entityType" },
    {
      title: tAudit("user"),
      dataIndex: "userName",
      key: "userName",
      render: (val: string | null) => val ?? "-",
    },
    {
      title: tAudit("timestamp"),
      dataIndex: "timestamp",
      key: "timestamp",
      render: (val: string) => formatDateTime(val),
    },
  ];

  return (
    <>
      <PageHeader title={t("home")} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title={tDash("totalUsers")}
          value={totalUsers}
          icon={<UserIcon />}
        />
        <StatCard
          title={tDash("deletedRecords")}
          value={softDeletedTotal}
          icon={<TrashIcon />}
        />
        <StatCard
          title={tDash("rolesInUse")}
          value={roleDistribution.length}
          icon={<ShieldIcon />}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <SectionCard title={tDash("usersByRole")}>
            {roleDistribution.length > 0 ? (
              <Chart
                type="pie"
                data={roleDistribution}
                nameKey="name"
                valueKey="value"
                height={280}
              />
            ) : (
              <div className="py-12 text-center text-muted-foreground">
                {tCommon("noData")}
              </div>
            )}
          </SectionCard>
        </div>
        <div className="lg:col-span-7">
          <SectionCard title={tDash("recentActivity")} noBodyPadding>
            <DataTable<RecentAudit>
              columns={recentColumns}
              dataSource={recentAudit}
              rowKey="id"
              emptyText={tCommon("noData")}
              size="small"
            />
          </SectionCard>
        </div>
      </div>
    </>
  );
}
