"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess } from "../use-jml";

/** §13.1's eight onboarding reports, in order (the leaver reports join in S6). */
export const JOIN_REPORTS = [
  "monthly-onboarding",
  "hr-workload",
  "onboarding-completion",
  "delayed-tasks",
  "upcoming-joiners",
  "completed-onboardings",
  "onboarding-volume-trend",
  "all-companies",
] as const;

export function ReportsIndex() {
  const t = useTranslations("jml.reports");
  const { can, isLoading } = useJmlAccess();
  if (isLoading) return <LoadingBlock />;
  if (!can("jml.viewReports")) return <NotPermitted title={t("title")} />;
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <SectionCard title={t("joinGroup")} subtitle={t("goLiveNote")}>
        <ul className="grid gap-3 sm:grid-cols-2">
          {JOIN_REPORTS.map((slug) => (
            <li key={slug}>
              <Link
                href={`/jml/reports/${slug}`}
                className="block rounded-md border border-border p-4 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="block text-sm font-medium text-foreground">
                  {t(`report.${slug}.title`)}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t(`report.${slug}.note`)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
