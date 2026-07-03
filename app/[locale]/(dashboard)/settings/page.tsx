"use client";

import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";

export default function SettingsPage() {
  const t = useTranslations("settings");

  return (
    <>
      <PageHeader title={t("title")} />
      <Card>
        <CardContent className="p-6">
          <DescriptionList
            items={[
              {
                key: "appName",
                label: t("appName"),
                value: process.env.NEXT_PUBLIC_APP_NAME ?? "My App",
              },
              {
                key: "environment",
                label: t("environment"),
                value: process.env.NODE_ENV,
              },
            ]}
          />
        </CardContent>
      </Card>
    </>
  );
}
