"use client";

import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { AiLimitsCard } from "@/components/hiring/settings/AiLimitsCard";
import { AiProviderCard } from "@/components/hiring/settings/AiProviderCard";
import { useHiringMe } from "@/components/hiring/ui/api";
import { Notice } from "@/components/hiring/ui/states";

/**
 * Admin › Settings › AI (ADR-097): the provider, key, model and limits every
 * module's AI uses. Edited by whoever configures AI today (`hiring.configure`);
 * the forms are the existing ones, now over the platform settings.
 */
export function PlatformAiSettings() {
  const t = useTranslations("adminSettings.ai");
  const { has, isLoading } = useHiringMe();
  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {!isLoading && !has("hiring.configure") ? (
        <Notice>{t("notPermitted")}</Notice>
      ) : (
        <>
          <AiProviderCard />
          <AiLimitsCard />
        </>
      )}
    </div>
  );
}
