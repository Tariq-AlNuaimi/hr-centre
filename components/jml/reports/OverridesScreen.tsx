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

type Report = {
  rows: Array<{
    gateId: string;
    overrideReason: string | null;
    overriddenAt: string;
    overriddenBy: { name: string | null } | null;
    case: { id: string; caseRef: string };
  }>;
  byGate: Array<{ key: string; count: number }>;
  byActor: Array<{ key: string; count: number }>;
  capReached: boolean;
};

/** Compliance-gate overrides in a month (AC-12.3), newest first, tallied by gate and by who. */
export function OverridesScreen() {
  const t = useTranslations("jml.reports.overrides");
  const { can, isLoading } = useJmlAccess();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const q = useQuery({
    queryKey: ["jml", "overrides", month],
    queryFn: () => apiClient.get<Report>(`/api/jml/leavers/overrides?month=${month}`),
    enabled: can("jml.viewReports") && /^\d{4}-\d{2}$/.test(month),
  });
  if (isLoading) return <LoadingBlock />;
  if (!can("jml.viewReports")) return <NotPermitted title={t("title")} />;
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("note")} />
      <Field id="ov-month" label={t("month")}>
        <Input
          id="ov-month"
          type="month"
          className="max-w-xs"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </Field>
      {q.isLoading ? <LoadingBlock /> : null}
      {q.isError ? <LoadFailed /> : null}
      {q.data ? (
        q.data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <>
            <SectionCard title={t("tallies")}>
              <p className="text-sm">
                {t("byGate", {
                  list: q.data.byGate.map((g) => `${g.key} (${g.count})`).join(", "),
                })}
              </p>
              <p className="text-sm">
                {t("byActor", {
                  list: q.data.byActor.map((g) => `${g.key} (${g.count})`).join(", "),
                })}
              </p>
            </SectionCard>
            <ul className="space-y-2">
              {q.data.rows.map((r) => (
                <li
                  key={`${r.case.id}-${r.gateId}`}
                  className="rounded-md border border-border p-3 text-sm"
                >
                  <Link
                    href={`/jml/cases/${r.case.id}?tab=compliance`}
                    className="font-medium text-primary hover:underline"
                  >
                    {r.case.caseRef}
                  </Link>{" "}
                  {t("row", {
                    gate: r.gateId,
                    by: r.overriddenBy?.name ?? "—",
                    at: r.overriddenAt.slice(0, 10),
                    reason: r.overrideReason ?? "",
                  })}
                </li>
              ))}
            </ul>
          </>
        )
      ) : null}
    </div>
  );
}
