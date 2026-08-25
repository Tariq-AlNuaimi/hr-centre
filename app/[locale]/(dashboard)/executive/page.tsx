"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageSkeleton } from "@/components/shared/Skeletons";
import { StatCard } from "@/components/shared/StatCard";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { CyclePicker } from "@/components/pms/CyclePicker";
import { useCycleSelection } from "@/hooks/use-cycle-selection";
import { usePmsActor } from "@/hooks/use-pms-actor";
import { apiClient } from "@/lib/api-client";

/**
 * §13.6 — the executive dashboard (COO / Ops Director).
 *
 * "Aggregate-first: org-wide band distributions across departments and entities,
 * completion health, compliance picture, bonus totals. Full drill-down on demand
 * into any individual's complete record, including salary/bonus. Read-only
 * throughout."
 *
 * ## Aggregate-first, literally
 *
 * All four aggregates are on the screen at once, above the fold on a laptop.
 * "Aggregate-first" is a statement about what an executive sees WITHOUT
 * navigating; splitting them across tabs would satisfy the word and not the
 * requirement.
 *
 * ## Drill-down is a link, not a panel
 *
 * §13.6's "full drill-down on demand into any individual's complete record" is
 * the people directory, which already enforces §4.5's salary rule for itself.
 * Rebuilding the individual record here would mean a second place for that check
 * to be got wrong; linking means there is exactly one.
 *
 * ## Read-only
 *
 * There is not one mutation on this screen, and `/api/reports/executive` exposes
 * no POST. §13.6's "read-only throughout" is a property of the surface rather
 * than of a hidden button.
 */

interface ExecutiveResponse {
  cycle: {
    id: string;
    year: number;
    status: string;
    published: boolean;
    publishedAt: string | null;
  };
  completion: {
    participantCount: number;
    progress: Array<{
      stageKind: string;
      completion: { done: number; total: number; percent: number };
    }>;
  };
  distribution: {
    orgWide: { headcount: number; bands: Record<string, number> };
    byDepartment: Array<{ name: string | null; headcount: number; bands: Record<string, number> }>;
    byEntity: Array<{ name: string | null; headcount: number; bands: Record<string, number> }>;
    bandOrder: string[];
  } | null;
  compliance: {
    misses: number;
    escalations: number;
    interventions: number;
    managersInvolved: number;
  };
  bonus: { total: string; eligible: number; ineligible: number; employees: number } | null;
}

export default function ExecutivePage() {
  const t = useTranslations("pms.executive");
  const tBand = useTranslations("pms.band");
  const tTeam = useTranslations("pms.team");
  const locale = useLocale();
  const { capabilities, isLoading: actorLoading } = usePmsActor();
  const { cycles, cycleList, cycleId, selectedCycleId, setSelectedCycleId } = useCycleSelection();

  const dashboard = useQuery({
    queryKey: ["pms", "executive", cycleId],
    queryFn: () => apiClient.get<ExecutiveResponse>(`/api/reports/executive?cycleId=${cycleId}`),
    enabled: cycleId !== null,
  });

  if (actorLoading || cycles.isLoading) return <PageSkeleton />;

  if (!capabilities.orgWide) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <SectionCard title={t("notPermitted")}>
          <EmptyState description={t("notPermittedHelp")} />
        </SectionCard>
      </div>
    );
  }

  if (cycleList.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <SectionCard title={t("noCycles")}>
          <EmptyState description={t("noCyclesHelp")} />
        </SectionCard>
      </div>
    );
  }

  const data = dashboard.data;
  const goal = data?.completion.progress.find((p) => p.stageKind === "GOAL_SETTING")?.completion;
  const year = data?.completion.progress.find((p) => p.stageKind === "YEAR_END")?.completion;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <CyclePicker
            cycles={cycleList}
            value={selectedCycleId ?? cycleId}
            onChange={setSelectedCycleId}
          />
        }
      />

      {dashboard.isLoading && <PageSkeleton />}

      {dashboard.isError && (
        <SectionCard title={t("loadFailed")}>
          <EmptyState
            description={t("loadFailedHelp")}
            actionLabel={t("retry")}
            onAction={() => void dashboard.refetch()}
          />
        </SectionCard>
      )}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title={t("headcount")}
              value={data.completion.participantCount}
              hint={
                data.cycle.published
                  ? t("published", {
                      when: data.cycle.publishedAt
                        ? new Date(data.cycle.publishedAt).toLocaleDateString()
                        : "",
                    })
                  : t("notPublished")
              }
            />
            <StatCard
              title={tTeam("goalSetting")}
              value={goal ? `${goal.percent}%` : "—"}
              hint={goal ? t("ofTotal", { done: goal.done, total: goal.total }) : ""}
            />
            <StatCard
              title={tTeam("yearEnd")}
              value={year ? `${year.percent}%` : "—"}
              hint={year ? t("ofTotal", { done: year.done, total: year.total }) : ""}
            />
            {/* §11.6 gates this one. Null when the viewer may not see money —
                which for the COO and Ops Director it never is. */}
            <StatCard
              title={t("bonusTotal")}
              value={data.bonus ? data.bonus.total : t("restricted")}
              hint={
                data.bonus
                  ? t("bonusHint", {
                      eligible: data.bonus.eligible,
                      ineligible: data.bonus.ineligible,
                    })
                  : t("restrictedHint")
              }
            />
          </div>

          <SectionCard title={t("compliance")} subtitle={t("complianceHelp")}>
            <div className="grid gap-3 sm:grid-cols-4">
              <Metric label={t("misses")} value={data.compliance.misses} />
              <Metric label={t("escalations")} value={data.compliance.escalations} />
              <Metric label={t("interventions")} value={data.compliance.interventions} />
              <Metric label={t("managersInvolved")} value={data.compliance.managersInvolved} />
            </div>
          </SectionCard>

          {data.distribution ? (
            <>
              <SectionCard title={t("distribution")} subtitle={t("distributionHelp")}>
                <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {data.distribution.bandOrder.map((band) => {
                    const count = data.distribution?.orgWide.bands[band] ?? 0;
                    const headcount = data.distribution?.orgWide.headcount ?? 0;
                    const pct = headcount ? Math.round((count / headcount) * 1000) / 10 : 0;
                    return (
                      <li key={band} className="rounded-md border border-border p-3">
                        <div className="text-xs text-muted-foreground">{tBand(band)}</div>
                        <div className="text-xl font-semibold">{count}</div>
                        <div className="text-xs text-muted-foreground">{pct}%</div>
                      </li>
                    );
                  })}
                </ul>
              </SectionCard>

              <SectionCard title={t("byDepartment")}>
                <BandGrid
                  groups={data.distribution.byDepartment}
                  bandOrder={data.distribution.bandOrder}
                  fallbackName={t("noDepartment")}
                />
              </SectionCard>

              <SectionCard title={t("byEntity")}>
                <BandGrid
                  groups={data.distribution.byEntity}
                  bandOrder={data.distribution.bandOrder}
                  fallbackName={t("noDepartment")}
                />
              </SectionCard>
            </>
          ) : (
            <SectionCard title={t("noScores")}>
              <EmptyState description={t("noScoresHelp")} />
            </SectionCard>
          )}

          <SectionCard title={t("drillDown")} subtitle={t("drillDownHelp")}>
            <Link
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={`/${locale}/people`}
            >
              {t("openDirectory")}
            </Link>
          </SectionCard>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

/**
 * Bands per group as a compact row of badges.
 *
 * A full table per grouping would be three wide tables on one page; §13.6 wants
 * the SHAPE of the distribution readable at a glance, and a row of counts gives
 * that without the reader parsing a grid.
 */
function BandGrid({
  groups,
  bandOrder,
  fallbackName,
}: {
  groups: Array<{ name: string | null; headcount: number; bands: Record<string, number> }>;
  bandOrder: string[];
  fallbackName: string;
}) {
  const tBand = useTranslations("pms.band");
  if (groups.length === 0) {
    return <EmptyState description={fallbackName} />;
  }
  return (
    <ul className="space-y-3">
      {groups.map((group, index) => (
        <li key={group.name ?? `unassigned-${index}`} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{group.name ?? fallbackName}</span>
            <span className="text-xs text-muted-foreground">{group.headcount}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {bandOrder.map((band) => (
              <Badge key={band} variant="outline">
                {tBand(band)}: {group.bands[band] ?? 0}
              </Badge>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
