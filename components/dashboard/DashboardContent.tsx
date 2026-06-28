"use client";

// Client island for the dashboard. The page itself is a React Server Component
// (it does the auth gate + Prisma reads on the server), but the interactive
// Ant Design pieces here -- the Chart (loaded via `next/dynamic { ssr:false }`)
// and the Table with `render` callbacks -- CANNOT live in a Server Component
// (functions/ssr:false components can't cross the RSC->client boundary). So the
// RSC passes serializable data down to this client component, which renders it.
// This is the canonical RSC + client-island split (see docs/recipes/perf/1-rsc-list-reads.md).

import { Card, Row, Col, Table, Tag } from "antd";
import { UserOutlined, DeleteOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { useTranslations } from "next-intl";
import { Chart } from "@/components/shared/Chart";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { SectionCard } from "@/components/shared/SectionCard";
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

const actionColor: Record<string, string> = {
  CREATE: "green",
  UPDATE: "blue",
  DELETE: "red",
  RESTORE: "gold",
};

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
        <Card>{tDash("welcome")}</Card>
      </>
    );
  }

  const { totalUsers, roleDistribution, softDeletedTotal, recentAudit } = data;

  return (
    <>
      <PageHeader title={t("home")} />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={8}>
          <StatCard
            title={tDash("totalUsers")}
            value={totalUsers}
            icon={<UserOutlined />}
          />
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <StatCard
            title={tDash("deletedRecords")}
            value={softDeletedTotal}
            icon={<DeleteOutlined />}
          />
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <StatCard
            title={tDash("rolesInUse")}
            value={roleDistribution.length}
            icon={<SafetyCertificateOutlined />}
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={10}>
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
              <div style={{ textAlign: "center", padding: 48, opacity: 0.5 }}>
                {tCommon("noData")}
              </div>
            )}
          </SectionCard>
        </Col>
        <Col xs={24} lg={14}>
          <SectionCard title={tDash("recentActivity")} noBodyPadding>
            <Table<RecentAudit>
              dataSource={recentAudit}
              rowKey="id"
              pagination={false}
              locale={{ emptyText: tCommon("noData") }}
              columns={[
                {
                  title: tAudit("action"),
                  dataIndex: "action",
                  key: "action",
                  render: (val: string) => (
                    <Tag color={actionColor[val] ?? "default"}>{val}</Tag>
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
              ]}
            />
          </SectionCard>
        </Col>
      </Row>
    </>
  );
}
