"use client";

// Living style guide — the design system on one screen. Doubles as a
// /design-qa target (every shared pattern + control state in light/dark/RTL)
// and as handoff documentation for the IT team. NOT in the sidebar nav: it's a
// reference, reachable at /<locale>/style-guide, not a stakeholder-facing
// feature. Labels here are intentionally hardcoded (a dev/design reference is
// exempt from the next-intl convention) — everything it *demonstrates* still
// flows through tokens + the shared components.

import { useState } from "react";
import {
  Typography,
  Button,
  Space,
  Divider,
  Input,
  Select,
  Switch,
  Tag,
  Alert,
  Table,
  Row,
  Col,
  theme,
} from "antd";
import {
  PlusOutlined,
  DownloadOutlined,
  UserOutlined,
  DeleteOutlined,
  SafetyCertificateOutlined,
  LockOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatCard } from "@/components/shared/StatCard";
import { SectionCard } from "@/components/shared/SectionCard";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { DataView } from "@/components/shared/DataView";
import { Toolbar } from "@/components/shared/Toolbar";
import { BrandedStatus } from "@/components/shared/BrandedStatus";
import {
  PageSkeleton,
  TableSkeleton,
  FormSkeleton,
} from "@/components/shared/Skeletons";
import { brand } from "@/brand.config";
import { OPEN_COMMAND_PALETTE } from "@/components/layout/CommandPalette";

const { Title, Text, Paragraph } = Typography;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <Title level={4} style={{ marginTop: 0 }}>
        {title}
      </Title>
      {children}
      <Divider />
    </section>
  );
}

type GalleryRow = { id: string; name: string; role: string; status: string };

export default function StyleGuidePage() {
  const { token } = theme.useToken();
  const [showSkeletons, setShowSkeletons] = useState(false);

  const sampleColumns = [
    { title: "Name", dataIndex: "name", key: "name" },
    { title: "Role", dataIndex: "role", key: "role", render: (r: string) => <Tag>{r}</Tag> },
    { title: "Status", dataIndex: "status", key: "status" },
  ];
  const sampleData = [
    { key: "1", name: "Sara Al-Hinai", role: "ADMIN", status: "Active" },
    { key: "2", name: "Yousef Said", role: "EDITOR", status: "Active" },
    { key: "3", name: "Layla Nasser", role: "VIEWER", status: "Invited" },
  ];
  const galleryRows: GalleryRow[] = sampleData.map((r) => ({
    id: r.key,
    name: r.name,
    role: r.role,
    status: r.status,
  }));

  // Brand color swatches come from theme tokens (no raw hex in a component).
  const swatches: { name: string; color: string }[] = [
    { name: "primary", color: token.colorPrimary },
    { name: "success", color: token.colorSuccess },
    { name: "warning", color: token.colorWarning },
    { name: "error", color: token.colorError },
  ];

  return (
    <>
      <PageHeader
        title="Style guide"
        subtitle="The design system in one place — tokens, typography, controls, and the shared patterns. Use it as the fidelity reference and the /design-qa target."
        actions={
          <Button icon={<DownloadOutlined />}>Export tokens</Button>
        }
      />

      <Section title="Typography">
        <Title level={1} style={{ margin: 0 }}>Heading 1</Title>
        <Title level={2} style={{ margin: 0 }}>Heading 2</Title>
        <Title level={3} style={{ margin: 0 }}>Heading 3</Title>
        <Title level={4} style={{ margin: 0 }}>Heading 4</Title>
        <Paragraph style={{ marginTop: "var(--space-3)" }}>
          Body text sits on the type scale in <code>app/tokens.css</code> /{" "}
          <code>antd-theme.ts</code>. <Text type="secondary">Secondary</Text>,{" "}
          <Text type="success">success</Text>, <Text type="warning">warning</Text>,{" "}
          <Text type="danger">danger</Text>, and <Text strong>strong</Text> variants.
        </Paragraph>
      </Section>

      <Section title="Buttons — one primary action per screen">
        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />}>Primary</Button>
          <Button>Default</Button>
          <Button type="dashed">Dashed</Button>
          <Button type="text">Text</Button>
          <Button type="link">Link</Button>
          <Button danger>Danger</Button>
          <Button type="primary" loading>Loading</Button>
          <Button disabled>Disabled</Button>
        </Space>
      </Section>

      <Section title="Form controls">
        <Space orientation="vertical" size="middle" style={{ width: "100%", maxWidth: 360 }}>
          <Input placeholder="Text input" />
          <Select
            placeholder="Select"
            aria-label="Select"
            style={{ width: "100%" }}
            options={[
              { value: "admin", label: "Admin" },
              { value: "editor", label: "Editor" },
              { value: "viewer", label: "Viewer" },
            ]}
          />
          <Space>
            <Switch defaultChecked aria-label="Toggle" /> <Text>Toggle</Text>
          </Space>
        </Space>
      </Section>

      <Section title="Status & feedback">
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <Space wrap>
            <Tag color="blue">Default</Tag>
            {/* Solid AA-contrast fills for the low-contrast hues: AntD's pastel
                `green`/`gold` filled tags miss WCAG AA, so status tags use the
                darkened semantic tokens (white text) instead. */}
            <Tag color={token.colorSuccess}>Active</Tag>
            <Tag color={token.colorWarning}>Pending</Tag>
            <Tag color="red">Blocked</Tag>
          </Space>
          <Alert type="success" showIcon title="Saved successfully." />
          <Alert type="error" showIcon title="Something went wrong. Try again." />
        </Space>
      </Section>

      <Section title="Table">
        <Table columns={sampleColumns} dataSource={sampleData} pagination={false} size="middle" />
      </Section>

      <Section title="Empty state">
        <EmptyState description="No records yet" actionLabel="Create one" onAction={() => {}} />
      </Section>

      <Section title="Brand identity (brand.config.ts)">
        <Space align="center" size="large" wrap>
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              inlineSize: 44,
              blockSize: 44,
              borderRadius: token.borderRadius,
              background: token.colorPrimary,
              color: token.colorTextLightSolid,
              fontSize: 20,
              fontWeight: 700,
            }}
          >
            {brand.monogram}
          </span>
          <div>
            <Text strong style={{ fontSize: 18 }}>{brand.appName}</Text>
            <Paragraph type="secondary" style={{ margin: 0 }}>
              Font: {brand.font.family} · density: {brand.density}
            </Paragraph>
          </div>
        </Space>
        <Space wrap style={{ marginTop: "var(--space-4)" }}>
          {swatches.map((s) => (
            <div key={s.name} style={{ textAlign: "center" }}>
              <div
                style={{
                  inlineSize: 56,
                  blockSize: 56,
                  borderRadius: token.borderRadius,
                  background: s.color,
                  border: `1px solid ${token.colorBorderSecondary}`,
                }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>{s.name}</Text>
            </div>
          ))}
        </Space>
      </Section>

      <Section title="KPI cards (StatCard)">
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={8}>
            <StatCard
              title="Total users"
              value="1,284"
              icon={<UserOutlined />}
              trend={{ value: 12, direction: "up" }}
            />
          </Col>
          <Col xs={24} sm={12} lg={8}>
            <StatCard
              title="Deleted records"
              value="37"
              icon={<DeleteOutlined />}
              trend={{ value: 4, direction: "down", positiveIsGood: false }}
            />
          </Col>
          <Col xs={24} sm={12} lg={8}>
            <StatCard
              title="Roles in use"
              value="3"
              icon={<SafetyCertificateOutlined />}
              hint="Admin · Editor · Viewer"
            />
          </Col>
        </Row>
      </Section>

      <Section title="Section card">
        <SectionCard
          title="Team members"
          subtitle="People with access to this workspace"
          actions={<Button type="primary" icon={<PlusOutlined />}>Invite</Button>}
        >
          <Table columns={sampleColumns} dataSource={sampleData} pagination={false} size="middle" />
        </SectionCard>
      </Section>

      <Section title="Description list (detail view)">
        <DescriptionList
          items={[
            { key: "name", label: "Name", value: "Sara Al-Hinai" },
            { key: "role", label: "Role", value: <Tag color="blue">ADMIN</Tag> },
            { key: "email", label: "Email", value: "sara@example.com" },
            { key: "status", label: "Status", value: <Tag color={token.colorSuccess}>Active</Tag> },
          ]}
        />
      </Section>

      <Section title="Data view — toolbar + bulk actions + column controls">
        <DataView<GalleryRow>
          dataSource={galleryRows}
          columns={[
            { title: "Name", dataIndex: "name", key: "name" },
            { title: "Role", dataIndex: "role", key: "role", render: (r: string) => <Tag>{r}</Tag> },
            { title: "Status", dataIndex: "status", key: "status" },
          ]}
          searchable
          toolbarActions={<Button type="primary" icon={<PlusOutlined />}>New</Button>}
          bulkActions={({ selectedRowKeys, clear }) => (
            <Button danger icon={<DeleteOutlined />} onClick={clear}>
              Delete {selectedRowKeys.length}
            </Button>
          )}
        />
      </Section>

      <Section title="Toolbar">
        <Toolbar
          start={<Input prefix={<UserOutlined />} placeholder="Filter…" style={{ maxWidth: 220 }} />}
          end={<Button type="primary" icon={<PlusOutlined />}>Create</Button>}
        />
      </Section>

      <Section title="Status pages (BrandedStatus)">
        <Row gutter={[16, 16]}>
          {[
            { code: "404", title: "Page not found", icon: undefined },
            { code: "403", title: "Access denied", icon: <LockOutlined /> },
            { code: undefined, title: "We'll be right back", icon: <ToolOutlined /> },
          ].map((s, i) => (
            <Col xs={24} md={8} key={i}>
              <div
                style={{
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: token.borderRadiusLG,
                  overflow: "hidden",
                }}
              >
                <BrandedStatus
                  minHeight={220}
                  code={s.code}
                  icon={s.icon}
                  title={s.title}
                />
              </div>
            </Col>
          ))}
        </Row>
      </Section>

      <Section title="Command palette & chrome">
        <Space wrap>
          <Button onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE))}>
            Open command palette (⌘K)
          </Button>
          <Text type="secondary">
            Notifications bell + workspace switcher live in the app header.
          </Text>
        </Space>
      </Section>

      <Section title="Loading skeletons (layout-matched)">
        <Space orientation="vertical" size="large" style={{ width: "100%" }}>
          <Space>
            <Switch
              checked={showSkeletons}
              onChange={setShowSkeletons}
              aria-label="Toggle skeletons"
            />
            <Text>Toggle skeletons</Text>
          </Space>
          {showSkeletons ? (
            <Space orientation="vertical" size="large" style={{ width: "100%" }}>
              <PageSkeleton rows={3} withAction />
              <TableSkeleton rows={4} />
              <FormSkeleton fields={3} />
            </Space>
          ) : (
            <Text type="secondary">Flip the switch to preview the loading silhouettes.</Text>
          )}
        </Space>
      </Section>
    </>
  );
}
