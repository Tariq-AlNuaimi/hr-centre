// React Server Component (no "use client"). This is the template's canonical
// RSC data-fetching example: it imports `@/lib/prisma` directly (server-only),
// queries on the server, and renders the result. No API round-trip, no client
// fetch, no loading spinner. Server components are the recommended place to read
// data per CLAUDE.md ("UI -> API route -> service -> Prisma" is for mutations and
// client-driven reads; RSCs read Prisma directly).

import { Typography, Card, Row, Col, Statistic, Table, Tag } from "antd";
import { UserOutlined, DeleteOutlined } from "@ant-design/icons";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma, prismaUnfiltered } from "@/lib/prisma";
import { Chart } from "@/components/shared/Chart";
import { RECYCLABLE_ENTITY_TYPES } from "@/lib/prisma/recyclable";

const { Title } = Typography;

// Recompute on every request -- this page reflects live counts.
export const dynamic = "force-dynamic";

interface RecentAudit {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userName: string | null;
  timestamp: string;
}

async function getDashboardData() {
  // total users + per-role breakdown (soft-delete filtered via `prisma`)
  const [totalUsers, usersByRole] = await Promise.all([
    prisma.user.count(),
    prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
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
  const t = await getTranslations("nav");
  const tCommon = await getTranslations("common");
  const tAudit = await getTranslations("auditLog");
  const tDash = await getTranslations("dashboard");

  // The dashboard surfaces user/role counts and recent audit-log entries -- both
  // ADMIN-gated elsewhere (audit-log API is withAdminAuth; the sidebar hides
  // users/audit-log from non-admins). Gate the data here too so this RSC doesn't
  // become a side-channel that leaks admin data to VIEWER/EDITOR.
  const session = await auth();
  const isAdmin = session?.user?.role === "ADMIN";

  if (!isAdmin) {
    return (
      <>
        <Title level={2}>{t("home")}</Title>
        <Card>{tDash("welcome")}</Card>
      </>
    );
  }

  const { totalUsers, roleDistribution, softDeletedTotal, recentAudit } =
    await getDashboardData();

  const actionColor: Record<string, string> = {
    CREATE: "green",
    UPDATE: "blue",
    DELETE: "red",
    RESTORE: "gold",
  };

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
            <Statistic
              title={tDash("rolesInUse")}
              value={roleDistribution.length}
            />
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
                {
                  title: tAudit("entity"),
                  dataIndex: "entityType",
                  key: "entityType",
                },
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
