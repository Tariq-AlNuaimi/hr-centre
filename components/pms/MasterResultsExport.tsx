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
 * §13.5's fifth report — "Master results export — full dataset: all employees,
 * all components, raw + calibrated scores, bands, calibration adjustments with
 * reasons, full audit trail. Restricted to HR Super Admin only (not HRBP)."
 *
 * The on-screen table is a PREVIEW of the workbook, not a second view of the
 * data: same rows, same order, fewer columns because a fifteen-column table is
 * not readable on a screen and the workbook is the deliverable. The audit trail
 * lives on the workbook's second tab and is summarised here as a count — a
 * five-thousand-row log is something to open in Excel, not to scroll in a page.
 *
 * This component is only ever mounted when `capabilities.exportMasterResults` is
 * true, and the route checks `canExportMasterResults` regardless.
 */

interface MasterRow {
  employeeId: string;
  name: string;
  department: string | null;
  entity: string;
  roleTrack: string;
  managerName: string | null;
  corporateScore: string;
  departmentalScore: string | null;
  individualScore: string;
  threeSixtyScore: string | null;
  /** §9.5's denominator — how many 360 forms the figure above averaged over. */
  threeSixtyRaterCount: number | null;
  rawScore: string;
  rawBand: string;
  calibratedBand: string;
  adjusted: boolean;
  adjustments: Array<{ fromBand: string; toBand: string; reason: string; by: string }>;
}

interface MasterResponse {
  cycleId: string;
  year: number;
  runStartedAt: string;
  rows: MasterRow[];
  totals: { employees: number; adjusted: number; auditRows: number };
}

export function MasterResultsExport({ cycleId }: { cycleId: string }) {
  const t = useTranslations("pms.reports.master");
  const tBand = useTranslations("pms.band");

  const query = useQuery({
    queryKey: ["pms", "report", "master", cycleId],
    queryFn: () => apiClient.get<MasterResponse>(`/api/reports/master-results?cycleId=${cycleId}`),
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

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title={t("employees")} value={data.totals.employees} />
        <StatCard title={t("adjusted")} value={data.totals.adjusted} hint={t("adjustedHint")} />
        <StatCard title={t("auditRows")} value={data.totals.auditRows} hint={t("auditHint")} />
      </div>

      <SectionCard
        title={t("title")}
        subtitle={t("help")}
        actions={
          <a
            className={buttonVariants({ size: "sm" })}
            href={`/api/reports/master-results?cycleId=${cycleId}&format=xlsx`}
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
          <DataTable<MasterRow>
            rowKey="employeeId"
            dataSource={data.rows}
            total={data.rows.length}
            page={1}
            pageSize={data.rows.length}
            columns={[
              {
                key: "name",
                title: t("employee"),
                render: (_v: unknown, row: MasterRow) => (
                  <div>
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.department ?? row.entity} · {row.employeeId}
                    </div>
                  </div>
                ),
              },
              {
                key: "components",
                title: t("components"),
                render: (_v: unknown, row: MasterRow) => (
                  <div className="text-xs text-muted-foreground">
                    {t("corporate")} {row.corporateScore}
                    {row.departmentalScore && ` · ${t("departmental")} ${row.departmentalScore}`}
                    {` · ${t("individual")} ${row.individualScore}`}
                    {row.threeSixtyScore && ` · 360 ${row.threeSixtyScore}`}
                    {/* The denominator the 360 figure rests on (§9.5 averages
                        over however many raters arrived), so a 4.60 from one
                        form cannot read the same as a 4.60 from three. It was
                        a workbook column only; HR reads this table at
                        calibration, which is where the fact is needed. */}
                    {row.threeSixtyScore && row.threeSixtyRaterCount !== null
                      ? ` (${t("raters", { count: row.threeSixtyRaterCount })})`
                      : null}
                  </div>
                ),
              },
              { key: "rawScore", title: t("rawScore"), dataIndex: "rawScore" },
              {
                key: "bands",
                title: t("bands"),
                render: (_v: unknown, row: MasterRow) => (
                  <div className="space-y-1">
                    <Badge variant="brand">{tBand(row.calibratedBand)}</Badge>
                    {/* §10.1 — the raw band survives, and the difference is the
                        audited layer. Shown only when it moved. */}
                    {row.adjusted && (
                      <div className="text-xs text-muted-foreground">
                        {t("wasBand", { band: tBand(row.rawBand) })}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: "reasons",
                title: t("reasons"),
                // §10.5's mandatory reason, in full — abbreviating the one field
                // that explains an override defeats the reason it is mandatory.
                render: (_v: unknown, row: MasterRow) =>
                  row.adjustments.length === 0 ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {row.adjustments.map((adjustment, index) => (
                        <li key={`${row.employeeId}-adj-${index}`}>
                          <span className="text-muted-foreground">
                            {tBand(adjustment.fromBand)} → {tBand(adjustment.toBand)} (
                            {adjustment.by}):
                          </span>{" "}
                          {adjustment.reason}
                        </li>
                      ))}
                    </ul>
                  ),
              },
            ]}
          />
        )}
      </SectionCard>
    </div>
  );
}
