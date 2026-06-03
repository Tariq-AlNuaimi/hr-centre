"use client";

import { Typography, Card, Descriptions } from "antd";
import { useTranslations } from "next-intl";

export default function SettingsPage() {
  const t = useTranslations("settings");

  return (
    <>
      <Typography.Title level={2}>{t("title")}</Typography.Title>
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
    </>
  );
}
