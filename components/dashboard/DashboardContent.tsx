"use client";

// Client island for the dashboard. The page itself is a React Server Component
// (it does the auth gate + Prisma reads on the server), but the interactive
// Ant Design pieces here -- the Chart (loaded via `next/dynamic { ssr:false }`)
// and the Table with `render` callbacks -- CANNOT live in a Server Component
// (functions/ssr:false components can't cross the RSC->client boundary). So the
// RSC passes serializable data down to this client component, which renders it.
// This is the canonical RSC + client-island split (see docs/recipes/perf/1-rsc-list-reads.md).

import { Typography, Card, Row, Col, Statistic, Table, Tag } from "antd";
import { UserOutlined, DeleteOutlined } from "@ant-design/icons";
import { useTranslations } from "next-intl";
import { Chart } from "@/components/shared/Chart";

const { Title } = Typography;

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
        <Title level={2}>{t("home")}</Title>
        <Card>{tDash("welcome")}</Card>
      </>
    );
  }

  const { totalUsers, roleDistribution, softDeletedTotal, recentAudit } = data;

  return (
    <>
      <Title level={2}>{t("home")}</Title>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={8}>
          <Card>
            <Statistic
              title={tDash("totalUsers")}
              value={totalUsers}
              prefix={<UserOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card>
            <Statistic
              title={tDash("deletedRecords")}
              value={softDeletedTotal}
              prefix={<DeleteOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card>
            <Statistic title={tDash("rolesInUse")} value={roleDistribution.length} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={10}>
          <Card title={tDash("usersByRole")}>
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
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title={tDash("recentActivity")}>
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
                  render: (val: string) => new Date(val).toLocaleString(),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}
