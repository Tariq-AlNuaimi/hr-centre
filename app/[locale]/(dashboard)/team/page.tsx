"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageSkeleton, TableSkeleton } from "@/components/shared/Skeletons";
import { StatCard } from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { CyclePicker } from "@/components/pms/CyclePicker";
import { StatusRoster, type StatusRow } from "@/components/pms/StatusRoster";
import { useCycleSelection } from "@/hooks/use-cycle-selection";
import { usePmsActor } from "@/hooks/use-pms-actor";
import { apiClient } from "@/lib/api-client";

/**
 * §13.3 — the manager workspace ("My Team status dashboard").
 *
 * "Across direct reports — status per stage (drafted/signed/self-assessed/etc.),
 * what's outstanding, what's approaching or past deadline. The manager's
 * operational cockpit to self-manage BEFORE escalations fire."
 *
 * That last clause decides the layout: the outstanding count leads, because the
 * screen exists to be read at a glance by someone deciding whether they need to
 * do anything today. Completion percentages come second — they are how the org
 * measures this manager, not what this manager acts on.
 *
 * ## Two scopes, one engine
 *
 * §13.3's second bullet gives "down-chain oversight (view-only): rolled-up
 * completion health across the deeper reporting tree". Both tabs call
 * `/api/status`, which serves §13.4's single engine — the only difference is the
 * `scope` parameter, and the route decides what that means, not this screen.
 *
 * The down-chain view carries no action affordances, and says so: `readOnly`
 * comes back in the payload rather than being inferred here, so the screen and
 * the route agree about what "view-only" means.
 */

interface StatusResponse {
  cycle: { id: string; year: number; status: string };
  scope: "direct" | "chain" | "org";
  readOnly: boolean;
  goalStageLocked: boolean;
  progress: Array<{
    stageKind: string;
    completion: { done: number; total: number; percent: number };
  }>;
  outstanding: string[];
  rows: StatusRow[];
}

export default function TeamPage() {
  const t = useTranslations("pms.team");
  const { capabilities, isLoading: actorLoading } = usePmsActor();
  const { cycles, cycleList, cycleId, selectedCycleId, setSelectedCycleId } = useCycleSelection();
  const [scope, setScope] = useState<"direct" | "chain">("direct");

  const status = useQuery({
    queryKey: ["pms", "status", cycleId, scope],
    queryFn: () => apiClient.get<StatusResponse>(`/api/status?cycleId=${cycleId}&scope=${scope}`),
    enabled: cycleId !== null,
  });

  if (actorLoading || cycles.isLoading) return <PageSkeleton />;

  // An affordance, never a control: `/api/status` re-checks for itself.
  const canWork = capabilities.lineManager || capabilities.orgWide;
  if (!canWork) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <SectionCard title={t("notYours")}>
          <EmptyState description={t("notYoursHelp")} />
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

  const data = status.data;
  const goal = data?.progress.find((p) => p.stageKind === "GOAL_SETTING");
  const year = data?.progress.find((p) => p.stageKind === "YEAR_END");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <div className="flex items-center gap-2">
            <CyclePicker
              cycles={cycleList}
              value={selectedCycleId ?? cycleId}
              onChange={setSelectedCycleId}
            />
          </div>
        }
      />

      {/* §13.3's two views. Buttons rather than a select: there are exactly two,
          and a manager switches between them constantly. */}
      <div className="flex gap-2" role="group" aria-label={t("scopeLabel")}>
        <Button
          variant={scope === "direct" ? "default" : "outline"}
          size="sm"
          onClick={() => setScope("direct")}
          aria-pressed={scope === "direct"}
        >
          {t("scopeDirect")}
        </Button>
        <Button
          variant={scope === "chain" ? "default" : "outline"}
          size="sm"
          onClick={() => setScope("chain")}
          aria-pressed={scope === "chain"}
        >
          {t("scopeChain")}
        </Button>
      </div>

      {status.isLoading && <TableSkeleton />}

      {status.isError && (
        <SectionCard title={t("loadFailed")}>
          <EmptyState
            description={t("loadFailedHelp")}
            actionLabel={t("retry")}
            onAction={() => void status.refetch()}
          />
        </SectionCard>
      )}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Leads, because §13.3 is a cockpit: this is the number that means
                "do something today". */}
            <StatCard
              title={t("outstanding")}
              value={data.outstanding.length}
              hint={t("outstandingHint")}
            />
            <StatCard
              title={t("goalSettingProgress")}
              value={goal ? `${goal.completion.percent}%` : "—"}
              hint={
                goal
                  ? t("ofTotal", { done: goal.completion.done, total: goal.completion.total })
                  : ""
              }
            />
            <StatCard
              title={t("yearEndProgress")}
              value={year ? `${year.completion.percent}%` : "—"}
              hint={
                year
                  ? t("ofTotal", { done: year.completion.done, total: year.completion.total })
                  : ""
              }
            />
          </div>

          <SectionCard
            title={scope === "direct" ? t("directTitle") : t("chainTitle")}
            subtitle={data.readOnly ? t("viewOnly") : t("directHelp")}
            noBodyPadding
          >
            {data.rows.length === 0 ? (
              <div className="p-6">
                <EmptyState description={scope === "direct" ? t("noReports") : t("noChain")} />
              </div>
            ) : (
              <StatusRoster rows={data.rows} showScores={data.rows.some((r) => r.band !== null)} />
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
