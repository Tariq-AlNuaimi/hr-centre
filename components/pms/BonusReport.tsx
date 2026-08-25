"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { StatCard } from "@/components/shared/StatCard";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { apiClient } from "@/lib/api-client";

/**
 * §13.5's "Bonus report + Excel export — §11.7 (HR-only to produce, logged)".
 *
 * ## The export is a link, not a fetch
 *
 * The .xlsx comes back as a file response with `content-disposition:
 * attachment`, so an ordinary anchor is what downloads it — the browser handles
 * the save, the session cookie authenticates it, and the route's audit row is
 * written on the way. Fetching it into memory to trigger a synthetic download
 * would add a copy of the payroll file to the page's heap for no benefit.
 *
 * ## Ineligible people are on the table, flagged
 *
 * §11.7 — "Ineligible employees are included and flagged (with reason: under 6
 * months), so nothing looks accidentally omitted." They are not filtered out and
 * not sorted to the bottom: an absent row is how payroll quietly underpays
 * someone, and a row at the end is one nobody scrolls to.
 */

interface BonusRow {
  employeeId: string;
  name: string;
  department: string | null;
  entity: string | null;
  basicSalary: string | null;
  finalBand: string;
  coefficient: number;
  workDays: number;
  effectiveMonths: string;
  eligible: boolean;
  ineligibleReason: string | null;
  bonus: string | null;
}

interface BonusResponse {
  cycleId: string;
  year: number;
  rows: BonusRow[];
  totals: { eligible: number; ineligible: number };
}

export function BonusReport({ cycleId }: { cycleId: string }) {
  const t = useTranslations("pms.reports.bonus");
  const tBand = useTranslations("pms.band");

  const query = useQuery({
    queryKey: ["pms", "report", "bonus", cycleId],
    queryFn: () => apiClient.get<BonusResponse>(`/api/bonus?cycleId=${cycleId}`),
  });

  if (query.isLoading) return <TableSkeleton />;
  if (query.isError || !query.data) {
    return (
      <SectionCard title={t("loadFailed")}>
        <EmptyState description={t("loadFailedHelp")} />
      </SectionCard>
    );
  }

  const data = query.data;
  const total = data.rows.reduce((sum, row) => sum + Number(row.bonus ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title={t("eligible")} value={data.totals.eligible} />
        <StatCard
          title={t("ineligible")}
          value={data.totals.ineligible}
          hint={t("ineligibleHint")}
        />
        <StatCard title={t("total")} value={total.toFixed(3)} hint={t("totalHint")} />
      </div>

      <SectionCard
        title={t("title")}
        subtitle={t("help")}
        actions={
          <a
            className={buttonVariants({ size: "sm" })}
            href={`/api/bonus?cycleId=${cycleId}&format=xlsx`}
            // §11.7 is a payroll handover, not navigation.
            download
          >
            {t("exportAction")}
          </a>
        }
        noBodyPadding
      >
        {data.rows.length === 0 ? (
          <div className="p-6">
            <EmptyState description={t("none")} />
          </div>
        ) : (
          <DataTable<BonusRow>
            rowKey="employeeId"
            dataSource={data.rows}
            total={data.rows.length}
            page={1}
            pageSize={data.rows.length}
            columns={[
              {
                key: "name",
                title: t("employee"),
                render: (_v: unknown, row: BonusRow) => (
                  <div>
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.department ?? row.entity} · {row.employeeId}
                    </div>
                  </div>
                ),
              },
              {
                key: "finalBand",
                title: t("band"),
                render: (_v: unknown, row: BonusRow) => (
                  <div className="space-y-1">
                    <Badge variant="brand">{tBand(row.finalBand)}</Badge>
                    <div className="text-xs text-muted-foreground">×{row.coefficient}</div>
                  </div>
                ),
              },
              {
                key: "basicSalary",
                title: t("basicSalary"),
                // §11.6 restricts this column's audience; the ROUTE decides
                // whether it is present at all, and it is null when it is not.
                render: (_v: unknown, row: BonusRow) => row.basicSalary ?? t("noSalary"),
              },
              { key: "workDays", title: t("workDays"), dataIndex: "workDays" },
              {
                key: "bonus",
                title: t("bonus"),
                render: (_v: unknown, row: BonusRow) =>
                  row.eligible ? (
                    <span className="font-medium">{row.bonus}</span>
                  ) : (
                    <div className="space-y-1">
                      <Badge variant="warning">{t("notEligible")}</Badge>
                      <div className="text-xs text-muted-foreground">{row.ineligibleReason}</div>
                    </div>
                  ),
              },
            ]}
          />
        )}
      </SectionCard>
    </div>
  );
}
