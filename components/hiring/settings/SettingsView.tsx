"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { useHiringMe } from "../ui/api";
import { Notice } from "../ui/states";
import { Tabs } from "@/components/shared/UrlTabs";
import { ApprovalsCard } from "./ApprovalsCard";
import { BudgetCard } from "./BudgetCard";
import { TawteenCard } from "./TawteenCard";
import { PanelModeCard, WeightsCard } from "./ScoringCards";

/**
 * `/hiring/settings` (Interview Hub Settings → AI, Scoring weights, Panel,
 * Approval chains, Budget envelope). Hiring admins change them; HR reads them;
 * anyone else is told this screen is for administrators.
 */
export function SettingsView() {
  const t = useTranslations("hiring.settings");
  const locale = useLocale();
  const { has, isLoading } = useHiringMe();
  if (!isLoading && !has("hiring.manage")) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("title")} />
        <Notice>{t("adminOnly")}</Notice>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Tabs
        tabs={[
          {
            key: "ai",
            label: t("tabAi"),
            // ADR-097: the provider and limits are platform settings now.
            content: (
              <Notice>
                {t.rich("aiMoved", {
                  link: (chunks) => (
                    <Link href={`/${locale}/admin/settings/ai`} className="underline">
                      {chunks}
                    </Link>
                  ),
                })}
              </Notice>
            ),
          },
          {
            key: "scoring",
            label: t("tabScoring"),
            content: (
              <div className="space-y-4">
                <WeightsCard />
                <PanelModeCard />
              </div>
            ),
          },
          { key: "approvals", label: t("tabApprovals"), content: <ApprovalsCard /> },
          {
            key: "budget",
            label: t("tabBudget"),
            content: (
              <div className="space-y-4">
                <BudgetCard />
                <TawteenCard />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
