"use client";

import { Card, Descriptions, Space } from "antd";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { PageHeader } from "@/components/shared/PageHeader";
import { AiProviderSettings } from "@/components/settings/AiProviderSettings";
import { BrowserEngineSettings } from "@/components/settings/BrowserEngineSettings";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <PageHeader title={t("title")} />
      <Card>
        <Descriptions column={1} bordered>
          <Descriptions.Item label={t("appName")}>
            {process.env.NEXT_PUBLIC_APP_NAME ?? "My App"}
          </Descriptions.Item>
          <Descriptions.Item label={t("environment")}>
            {process.env.NODE_ENV}
          </Descriptions.Item>
        </Descriptions>
      </Card>
      {/* These call admin-only APIs; only render them for admins. */}
      {isAdmin && <AiProviderSettings />}
      {isAdmin && <BrowserEngineSettings />}
    </Space>
  );
}
