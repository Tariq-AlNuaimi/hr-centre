"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { apiClient } from "@/lib/api-client";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess } from "../use-jml";

type Preview = {
  config:
    { configured: true; days: number; action: string } | { configured: false; reason: string };
  wouldProcess: number;
  onLegalHold: number;
};

/** Data retention (§17.3, BR-026): the rule and a dry run. Nothing is changed from here. */
export function RetentionSettings() {
  const t = useTranslations("jml.settings.retention");
  const { can, isLoading } = useJmlAccess();
  const data = useQuery({
    queryKey: ["jml", "retention"],
    queryFn: () => apiClient.get<Preview>("/api/jml/config/retention"),
    enabled: can("jml.configure"),
  });
  const header = <PageHeader title={t("title")} subtitle={t("subtitle")} />;
  if (isLoading) return <LoadingBlock />;
  if (!can("jml.configure")) return <NotPermitted title={t("title")} />;
  return (
    <div className="space-y-6">
      {header}
      {data.isLoading ? (
        <LoadingBlock />
      ) : data.isError || !data.data ? (
        <LoadFailed />
      ) : (
        <SectionCard title={t("rule")} subtitle={t("ruleNote")}>
          {data.data.config.configured ? (
            <DescriptionList
              items={[
                {
                  key: "days",
                  label: t("days"),
                  value: t("daysValue", { days: data.data.config.days }),
                },
                {
                  key: "action",
                  label: t("action"),
                  value: t(`actionValue.${data.data.config.action}`),
                },
                { key: "would", label: t("wouldProcess"), value: data.data.wouldProcess },
                { key: "hold", label: t("onHold"), value: data.data.onLegalHold },
              ]}
            />
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {t("notConfigured", { reason: data.data.config.reason })}
            </p>
          )}
        </SectionCard>
      )}
    </div>
  );
}
