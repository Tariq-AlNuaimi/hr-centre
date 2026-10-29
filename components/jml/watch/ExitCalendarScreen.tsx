"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import { Field } from "@/components/shared/FormControls";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess } from "../use-jml";

type Entry = {
  caseId: string;
  caseRef: string;
  employeeName: string;
  status: string;
  kind: "LPWD" | "LDS" | "BOTH";
  date: string;
  onWeekend: boolean;
  linkedTo: string | null;
};

/** The exit calendar (Module 15): exit dates only, by day; weekend dates flagged, never moved. */
export function ExitCalendarScreen() {
  const t = useTranslations("jml.exitCalendar");
  const { can, isLoading } = useJmlAccess();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const q = useQuery({
    queryKey: ["jml", "exit-calendar", month],
    queryFn: () =>
      apiClient.get<{ entries: Entry[] }>(`/api/jml/calendar/exits?year=${year}&month=${mon}`),
    enabled: can("jml.view") && /^\d{4}-\d{2}$/.test(month),
  });
  if (isLoading) return <LoadingBlock />;
  if (!can("jml.view")) return <NotPermitted title={t("title")} />;
  const days = [...new Set((q.data?.entries ?? []).map((e) => e.date))];
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Field id="xc-month" label={t("month")}>
        <Input
          id="xc-month"
          type="month"
          className="max-w-xs"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </Field>
      {q.isLoading ? <LoadingBlock /> : null}
      {q.isError ? <LoadFailed /> : null}
      {q.data && days.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : null}
      {days.map((d) => (
        <SectionCard key={d} title={d}>
          <ul className="space-y-1 text-sm">
            {q
              .data!.entries.filter((e) => e.date === d)
              .map((e) => (
                <li key={`${e.caseId}-${e.kind}`} className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/jml/cases/${e.caseId}?tab=overview`}
                    className="font-medium text-primary hover:underline"
                  >
                    {e.caseRef}
                  </Link>
                  <span>{e.employeeName}</span>
                  <span className="text-muted-foreground">{t(`kind.${e.kind}`)}</span>
                  {e.linkedTo ? (
                    <span className="text-xs text-muted-foreground">
                      {t("linked", { date: e.linkedTo })}
                    </span>
                  ) : null}
                  {e.onWeekend ? (
                    <span className="rounded bg-status-warn px-1 text-xs text-status-warn-fg">
                      {t("weekend")}
                    </span>
                  ) : null}
                </li>
              ))}
          </ul>
        </SectionCard>
      ))}
    </div>
  );
}
