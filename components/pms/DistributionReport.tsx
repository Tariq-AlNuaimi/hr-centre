"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/lib/api-client";
import { BandDistributionChart } from "@/components/pms/BandDistributionChart";

/**
 * §13.5 — "Results distribution report — band breakdown per department / entity /
 * org-wide (also feeds calibration)."
 *
 * Three things are on every row and each answers a different question:
 *
 *   - the CALIBRATED counts — what the organisation actually decided;
 *   - the MOVEMENT from raw — how much §10's curve moved this group, which §10.1
 *     keeps as a separate, audited layer rather than an overwrite;
 *   - the GAP to target — §10.3's guidance, shown only where §10.3 says the
 *     curve applies (a group below the minimum size gets no gap, because it has
 *     no curve of its own).
 *
 * Nothing here refuses or warns: §10.4 is explicit that the curve is "guided,
 * not forced".
 */

type Distribution = Record<string, number>;

interface Summary {
  headcount: number;
  curveEligible: boolean;
  calibrated: Distribution;
  raw: Distribution;
  gap: { counts?: Distribution; percentages?: Distribution } | null;
  movement: Distribution;
}

interface DistributionResponse {
  cycleId: string;
  year: number;
  run: { startedAt: string; scoredCount: number; skippedCount: number } | null;
  targetPct: Distribution | null;
  orgWide: Summary | null;
  byDepartment: Array<{ id: string; name: string | null } & Summary>;
  byEntity: Array<{ id: string; name: string | null } & Summary>;
}

type GroupRow = DistributionResponse["byDepartment"][number] & { key: string };

const BANDS = ["OUTSTANDING", "EXCELLENT", "TARGET", "ALMOST_ACHIEVED", "UNSATISFACTORY"];

export function DistributionReport({ cycleId }: { cycleId: string }) {
  const t = useTranslations("pms.reports.distribution");
  const tBand = useTranslations("pms.band");

  const query = useQuery({
    queryKey: ["pms", "report", "distribution", cycleId],
    queryFn: () =>
      apiClient.get<DistributionResponse>(`/api/reports/results-distribution?cycleId=${cycleId}`),
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
  if (!data.run || !data.orgWide) {
    return (
      <SectionCard title={t("noRun")}>
        <EmptyState description={t("noRunHelp")} />
      </SectionCard>
    );
  }

  const bandColumns = BANDS.map((band) => ({
    key: band,
    title: tBand(band),
    render: (_v: unknown, row: GroupRow | (Summary & { key: string; name: string | null })) => {
      const count = row.calibrated[band] ?? 0;
      const moved = row.movement[band] ?? 0;
      return (
        <div className="space-y-0.5">
          <div>{count}</div>
          {/* §10.1's separate layer, made visible: how many people the curve
              moved into or out of this band. Silent when nothing moved. */}
          {moved !== 0 && (
            <div className="text-xs text-muted-foreground">{moved > 0 ? `+${moved}` : moved}</div>
          )}
        </div>
      );
    },
  }));

  const columns = [
    {
      key: "name",
      title: t("group"),
      render: (_v: unknown, row: GroupRow) => (
        <div>
          <div className="font-medium">{row.name ?? t("noDepartment")}</div>
          <div className="text-xs text-muted-foreground">
            {t("headcount", { count: row.headcount })}
            {/* §10.3 — "smaller departments roll up", so a group under the
                threshold has no curve and no gap. Said, not implied by a
                blank cell. */}
            {!row.curveEligible && ` · ${t("belowThreshold")}`}
          </div>
        </div>
      ),
    },
    ...bandColumns,
  ];

  const keyed = (rows: DistributionResponse["byDepartment"]): GroupRow[] =>
    rows.map((row, index) => ({ ...row, key: row.id || `unassigned-${index}` }));

  return (
    <div className="space-y-6">
      <SectionCard
        title={t("orgWide")}
        subtitle={t("runAt", {
          when: new Date(data.run.startedAt).toLocaleString(),
          scored: data.run.scoredCount,
        })}
      >
        <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {BANDS.map((band) => {
            const count = data.orgWide?.calibrated[band] ?? 0;
            const pct = data.orgWide?.headcount
              ? Math.round((count / data.orgWide.headcount) * 1000) / 10
              : 0;
            const target = data.targetPct?.[band];
            return (
              <li key={band} className="rounded-md border border-border p-3">
                <div className="text-xs text-muted-foreground">{tBand(band)}</div>
                <div className="text-xl font-semibold">{count}</div>
                <div className="text-xs text-muted-foreground">{pct}%</div>
                {target !== undefined && (
                  <Badge variant="outline" className="mt-1">
                    {t("target", { pct: target })}
                  </Badge>
                )}
              </li>
            );
          })}
        </ul>
        <div className="mt-4">
          <BandDistributionChart
            counts={data.orgWide.calibrated}
            headcount={data.orgWide.headcount}
            targetPct={data.targetPct}
            prior={null}
          />
        </div>
      </SectionCard>

      <SectionCard title={t("byDepartment")} subtitle={t("movementHelp")} noBodyPadding>
        <DataTable<GroupRow>
          rowKey="key"
          dataSource={keyed(data.byDepartment)}
          total={data.byDepartment.length}
          page={1}
          pageSize={data.byDepartment.length || 1}
          columns={columns}
        />
      </SectionCard>

      <SectionCard title={t("byEntity")} noBodyPadding>
        <DataTable<GroupRow>
          rowKey="key"
          dataSource={keyed(data.byEntity)}
          total={data.byEntity.length}
          page={1}
          pageSize={data.byEntity.length || 1}
          columns={columns}
        />
      </SectionCard>
    </div>
  );
}
