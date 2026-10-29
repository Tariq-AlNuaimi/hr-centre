"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

/**
 * P2-2 — "My year": the agreed KPI set and weights, what changed at mid-year,
 * and the stage dates, so the page is useful in all twelve months rather than
 * only after release. Results stay in the scorecard section below it, behind
 * §13.2's publish gate.
 */

interface MyYearResponse {
  cycle: { id: string; year: number; status: string; published: boolean };
  stages: Array<{
    kind: string;
    opensAt: string;
    deadline: string;
    state: "NOT_YET_OPEN" | "OPEN" | "LOCKED";
  }>;
  enrolled: boolean;
  goalsApprovedAt: string | null;
  kpis: Array<{ id: string; description: string; weightage: string }>;
  midYear: Array<{
    id: string;
    status: string;
    rationale: string;
    requestedAt: string;
    decidedAt: string | null;
    decisionReason: string | null;
  }>;
}

export function MyYear({ cycleId }: { cycleId: string }) {
  const t = useTranslations("pms.myYear");
  const query = useQuery({
    queryKey: ["pms", "my-year", cycleId],
    queryFn: () => apiClient.get<MyYearResponse>(`/api/pms/my-year?cycleId=${cycleId}`),
  });

  if (query.isLoading) return <TableSkeleton />;
  if (query.isError || !query.data) {
    return (
      <SectionCard title={t("loadFailed")}>
        <EmptyState
          description={t("loadFailedHelp")}
          actionLabel={t("retry")}
          onAction={() => void query.refetch()}
        />
      </SectionCard>
    );
  }

  const data = query.data;
  if (!data.enrolled) {
    return (
      <SectionCard title={t("notEnrolled", { year: data.cycle.year })}>
        <EmptyState description={t("notEnrolledHelp")} />
      </SectionCard>
    );
  }

  const total = data.kpis.reduce((sum, k) => sum + Number(k.weightage), 0);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <SectionCard title={t("timeline")} subtitle={t("timelineHelp")}>
        <ol className="space-y-3">
          {data.stages.map((stage) => (
            <li key={stage.kind} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{t(`stage.${stage.kind}`)}</span>
                <Badge variant={stage.state === "OPEN" ? "default" : "outline"}>
                  {t(`state.${stage.state}`)}
                </Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t("window", {
                  opens: formatDate(stage.opensAt),
                  deadline: formatDate(stage.deadline),
                })}
              </div>
            </li>
          ))}
        </ol>
      </SectionCard>

      <div className="space-y-6 lg:col-span-2">
        <SectionCard
          title={t("kpis")}
          subtitle={
            data.goalsApprovedAt
              ? t("kpisApproved", { when: formatDate(data.goalsApprovedAt) })
              : t("kpisNotApproved")
          }
        >
          {data.kpis.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noKpis")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-xs text-muted-foreground">
                  <th scope="col" className="pb-2 text-start font-medium">
                    {t("kpi")}
                  </th>
                  <th scope="col" className="w-24 pb-2 text-end font-medium">
                    {t("weight")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.kpis.map((kpi) => (
                  <tr key={kpi.id} className="border-t border-border">
                    <td className="py-2 pe-3">{kpi.description}</td>
                    <td className="py-2 text-end tabular-nums">{Number(kpi.weightage)}%</td>
                  </tr>
                ))}
                <tr className="border-t border-border font-medium">
                  <td className="py-2">{t("total")}</td>
                  <td className="py-2 text-end tabular-nums">{Math.round(total * 100) / 100}%</td>
                </tr>
              </tbody>
            </table>
          )}
        </SectionCard>

        <SectionCard title={t("midYear")} subtitle={t("midYearHelp")}>
          {data.midYear.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noMidYear")}</p>
          ) : (
            <ul className="space-y-3">
              {data.midYear.map((r) => (
                <li key={r.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(r.requestedAt)}
                    </span>
                    <Badge variant="outline">{t(`requestStatus.${r.status}`)}</Badge>
                  </div>
                  <p className="mt-1">{r.rationale}</p>
                  {r.decisionReason && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("decision", { reason: r.decisionReason })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
