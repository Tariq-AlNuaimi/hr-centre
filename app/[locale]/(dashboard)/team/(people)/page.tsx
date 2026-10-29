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
import { TeamOverview } from "@/components/people/TeamOverview";

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
  /** §13.4 — the org-scope read is capped; the route says so, so the screen must too. */
  truncated: boolean;
  goalStageLocked: boolean;
  progress: Array<{
    stageKind: string;
    completion: { done: number; total: number; percent: number };
  }>;
  outstanding: string[];
  rows: StatusRow[];
}

/**
 * §13.3/§13.4 — the copy each scope gets, keyed by the scope the SERVER reports.
 *
 * A table rather than nested ternaries at three call sites: the three strings
 * that describe a roster have to move together, and the org row is the one that
 * was missing when HR read "Direct reports" over the whole organisation.
 */
const SCOPE_COPY = {
  direct: {
    title: "directTitle",
    help: "directHelp",
    empty: "noReports",
    stat: "outstanding",
    statHint: "outstandingHint",
  },
  chain: {
    title: "chainTitle",
    help: "directHelp",
    empty: "noChain",
    stat: "outstandingChain",
    statHint: "outstandingChainHint",
  },
  org: {
    title: "orgTitle",
    help: "orgHelp",
    empty: "noOrg",
    stat: "outstandingOrg",
    statHint: "outstandingOrgHint",
  },
} as const;

/**
 * `data.scope` crosses the wire into an unchecked `as` cast, so the lookup is
 * defensive: an unexpected value would otherwise make `t(scopeCopy.title)` throw
 * and blank the screen — a white page instead of the honest state the rubric asks
 * for. Kept out of the component so the fallback costs it no complexity.
 */
function scopeCopyFor(
  scope: StatusResponse["scope"],
): (typeof SCOPE_COPY)[keyof typeof SCOPE_COPY] {
  return SCOPE_COPY[scope] ?? SCOPE_COPY.direct;
}

/**
 * §13.4's cap, said rather than implied. The org-scope read is bounded
 * (`participantStatuses` stops at `PARTICIPANT_PAGE`), and presenting a capped
 * subset's completion percentages as the organisation's would be a confident
 * wrong number — the failure mode this screen was just fixed for.
 *
 * Its own component so the conditional costs `TeamPage` no complexity.
 */
function TruncatedNotice({ truncated, shown }: { truncated: boolean; shown: number }) {
  const t = useTranslations("pms.team");
  if (!truncated) return null;
  return (
    <p className="text-sm text-muted-foreground" role="status">
      {t("truncatedNotice", { shown })}
    </p>
  );
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
        <TeamOverview />
        <SectionCard title={t("noCycles")}>
          <EmptyState description={t("noCyclesHelp")} />
        </SectionCard>
      </div>
    );
  }

  const data = status.data;
  const goal = data?.progress.find((p) => p.stageKind === "GOAL_SETTING");
  const year = data?.progress.find((p) => p.stageKind === "YEAR_END");

  // §13.4 — the SERVER decides scope, not this toggle: an actor with org-wide
  // capability gets every participant back whatever `scope` was requested, and
  // the response says so. Labelling from the local toggle put "Direct reports —
  // the people you draft, review and sign for" over the whole organisation for
  // HR, who line-manages nobody. Read the scope off the response; fall back to
  // the toggle only before the first payload lands.
  const effectiveScope = data?.scope ?? scope;
  const isOrgScope = effectiveScope === "org";
  const scopeCopy = scopeCopyFor(effectiveScope);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={isOrgScope ? t("orgSubtitle") : t("subtitle")}
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

      {/* UX P1 R14 — the team across modules, then the Performance roster. */}
      <TeamOverview orgScope={isOrgScope} />

      {/* §13.3's two views. Buttons rather than a select: there are exactly two,
          and a manager switches between them constantly. Hidden at org scope:
          `/api/status` returns every participant for an org-wide actor whatever
          this asks for, so leaving it on screen is a dead control (design.md —
          "no dead controls"). */}
      {!isOrgScope && (
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
      )}

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
              title={t(scopeCopy.stat)}
              value={data.outstanding.length}
              hint={t(scopeCopy.statHint)}
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

          <TruncatedNotice truncated={data.truncated} shown={data.rows.length} />

          <SectionCard
            title={t(scopeCopy.title)}
            subtitle={data.readOnly ? t("viewOnly") : t(scopeCopy.help)}
            noBodyPadding
          >
            {data.rows.length === 0 ? (
              <div className="p-6">
                <EmptyState description={t(scopeCopy.empty)} />
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
