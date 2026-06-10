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
} from "antd";
import { PlusOutlined, DownloadOutlined } from "@ant-design/icons";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  PageSkeleton,
  TableSkeleton,
  FormSkeleton,
} from "@/components/shared/Skeletons";

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

export default function StyleGuidePage() {
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
            style={{ width: "100%" }}
            options={[
              { value: "admin", label: "Admin" },
              { value: "editor", label: "Editor" },
              { value: "viewer", label: "Viewer" },
            ]}
          />
          <Space>
            <Switch defaultChecked /> <Text>Toggle</Text>
          </Space>
        </Space>
      </Section>

      <Section title="Status & feedback">
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <Space wrap>
            <Tag color="blue">Default</Tag>
            <Tag color="green">Active</Tag>
            <Tag color="gold">Pending</Tag>
            <Tag color="red">Blocked</Tag>
          </Space>
          <Alert type="success" showIcon message="Saved successfully." />
          <Alert type="error" showIcon message="Something went wrong. Try again." />
        </Space>
      </Section>

      <Section title="Table">
        <Table columns={sampleColumns} dataSource={sampleData} pagination={false} size="middle" />
      </Section>

      <Section title="Empty state">
        <EmptyState description="No records yet" actionLabel="Create one" onAction={() => {}} />
      </Section>

      <Section title="Loading skeletons (layout-matched)">
        <Space orientation="vertical" size="large" style={{ width: "100%" }}>
          <Space>
            <Switch checked={showSkeletons} onChange={setShowSkeletons} />
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
