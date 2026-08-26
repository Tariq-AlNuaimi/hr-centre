"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { StatCard } from "@/components/shared/StatCard";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/lib/api-client";

/**
 * §13.5 — "Manager compliance report — deadline misses & escalations per
 * manager, for top management (§5.6)."
 *
 * §5.6 fixes the four facts each row carries: manager name, what was missed, by
 * how long, and whether skip-level or HR intervention was required. All four are
 * columns here, in that order, because the clause is the specification of this
 * table and not merely a description of it.
 *
 * ## The employee-own-miss list is separate, and stays separate
 *
 * Appendix A — "an employee is never disadvantaged by a manager's inaction", and
 * its converse: a manager is never charged with an employee's own missed
 * signature (§5.4). Those events come back under their own key and are rendered
 * below the table, never folded into anyone's tally.
 */

interface ComplianceResponse {
  cycleId: string;
  year: number;
  managers: Array<{
    managerId: string;
    managerName: string;
    managerNumber: string;
    department: string | null;
    misses: number;
    escalations: number;
    hrInterventions: number;
    worstOverdueHours: number;
    affectedEmployeeCount: number;
    events: Array<{
      stageKind: string;
      kind: string;
      missedByHours: number | null;
      detail: string;
      occurredAt: string;
      subjectName: string;
    }>;
  }>;
  employeeOwnMisses: Array<{ name: string; kind: string; occurredAt: string }>;
  totals: { managersWithMisses: number; totalMisses: number; totalEscalations: number };
}

type ManagerRow = ComplianceResponse["managers"][number];

export function ManagerComplianceReport({ cycleId }: { cycleId: string }) {
  const t = useTranslations("pms.reports.compliance");

  const query = useQuery({
    queryKey: ["pms", "report", "compliance", cycleId],
    queryFn: () =>
      apiClient.get<ComplianceResponse>(`/api/reports/manager-compliance?cycleId=${cycleId}`),
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
        <StatCard title={t("managersWithMisses")} value={data.totals.managersWithMisses} />
        <StatCard title={t("totalMisses")} value={data.totals.totalMisses} />
        <StatCard title={t("totalEscalations")} value={data.totals.totalEscalations} />
      </div>

      <SectionCard title={t("title")} subtitle={t("help")} noBodyPadding>
        {data.managers.length === 0 ? (
          <div className="p-6">
            {/* A clean record is the good outcome, and reads as one. */}
            <EmptyState description={t("none")} />
          </div>
        ) : (
          <DataTable<ManagerRow>
            rowKey="managerId"
            dataSource={data.managers}
            total={data.managers.length}
            page={1}
            pageSize={data.managers.length}
            columns={[
              {
                key: "manager",
                title: t("manager"),
                render: (_v: unknown, row: ManagerRow) => (
                  <div>
                    <div className="font-medium">{row.managerName}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.department ?? "—"} · {row.managerNumber}
                    </div>
                  </div>
                ),
              },
              {
                key: "misses",
                title: t("misses"),
                render: (_v: unknown, row: ManagerRow) => (
                  <div className="space-y-1">
                    <Badge variant={row.misses > 0 ? "danger" : "outline"}>{row.misses}</Badge>
                    <div className="text-xs text-muted-foreground">
                      {t("affecting", { count: row.affectedEmployeeCount })}
                    </div>
                  </div>
                ),
              },
              {
                key: "worstOverdueHours",
                title: t("byHowLong"),
                // §5.6's "by how long", in days where it is more than one — a
                // count of 312 hours is not a number anyone reasons about.
                render: (_v: unknown, row: ManagerRow) =>
                  row.worstOverdueHours >= 48
                    ? t("days", { days: Math.floor(row.worstOverdueHours / 24) })
                    : t("hours", { hours: row.worstOverdueHours }),
              },
              {
                key: "escalations",
                title: t("escalations"),
                render: (_v: unknown, row: ManagerRow) => (
                  <div className="space-y-1">
                    <div>{t("escalated", { count: row.escalations })}</div>
                    {row.hrInterventions > 0 && (
                      <Badge variant="warning">
                        {t("hrIntervened", { count: row.hrInterventions })}
                      </Badge>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </SectionCard>

      <SectionCard title={t("employeeOwn")} subtitle={t("employeeOwnHelp")}>
        {data.employeeOwnMisses.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noEmployeeOwn")}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.employeeOwnMisses.map((miss, index) => (
              <li key={`${miss.name}-${index}`} className="text-muted-foreground">
                {miss.name} — {new Date(miss.occurredAt).toLocaleDateString()}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
