"use client";

import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";

type Bucket = Array<{ label: string; count: number }>;

export type Totals = {
  total: number;
  confirmed: number;
  onWeekend: number;
  byCompany: Bucket;
  byDirectorate: Bucket;
  byDepartment: Bucket;
  byEmploymentType: Bucket;
  byWorkLocation: Bucket;
  byStatus: Bucket;
  byHrOwner: Bucket;
};

const BREAKDOWNS = [
  "byCompany",
  "byDirectorate",
  "byDepartment",
  "byEmploymentType",
  "byWorkLocation",
  "byStatus",
  "byHrOwner",
] as const;

/** Range totals and the seven breakdowns (Onboarding §12). */
export function CalendarTotals({ totals }: { totals: Totals }) {
  const t = useTranslations("jml.calendar.totals");
  return (
    <SectionCard
      title={t("title")}
      subtitle={t("summary", {
        total: totals.total,
        confirmed: totals.confirmed,
        weekend: totals.onWeekend,
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {BREAKDOWNS.map((key) => (
          <div key={key}>
            <h4 className="mb-1 text-xs font-semibold text-muted-foreground">{t(key)}</h4>
            <ul className="space-y-0.5 text-sm">
              {totals[key].length === 0 ? (
                <li className="text-muted-foreground">{t("none")}</li>
              ) : null}
              {totals[key].map((b) => (
                <li key={b.label} className="flex justify-between gap-2">
                  <span className="truncate">{b.label}</span>
                  <span className="tabular-nums">{b.count}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
