"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { PageSkeleton, TableSkeleton } from "@/components/shared/Skeletons";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PerformanceCycle } from "@/components/pms/CycleList";
import { ParticipantList, type RosterResponse } from "@/components/pms/ParticipantList";
import { FilterChips } from "@/components/shared/FilterBar";

const GOAL_STATES = [
  "notDrafted",
  "awaitingManager",
  "awaitingEmployee",
  "awaitingHr",
  "approved",
] as const;
import { StageBanner } from "@/components/pms/StageBanner";
import { usePmsActor } from "@/hooks/use-pms-actor";
import { apiClient } from "@/lib/api-client";

/**
 * Goal setting — the line manager's workspace for spec §5.
 *
 * List archetype: PageHeader → the stage window (§5.4's hard lock, stated up
 * front rather than discovered on submit) → a year filter → the roster, each
 * row linking to the drafting screen.
 *
 * WHO SEES THIS. §4.2 reserves drafting and sign-off for the DIRECT line
 * manager, and §4.1 gives HR the org-wide override. Anyone else has no roster to
 * work — their own KPI set reaches them through My Tasks on the home page — so
 * the nav entry and this screen ask the same question the routes ask. It is an
 * affordance, never a control: `/api/cycles/[id]/participants` scopes the rows
 * itself, and a plain employee who typed the URL would simply see their own row.
 *
 * WHICH YEAR. The default is the OPEN cycle (§2 runs one year at a time); older
 * years stay reachable through the picker, because a closed year's KPI set is
 * still the agreed record of what was set.
 */

/** Cycles + the roster for the chosen year, and the derived selection. */
function useGoalSettingRoster(
  enabled: boolean,
  query: { page: number; pageSize: number; search: string; state: string },
) {
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);

  const cycles = useQuery({
    queryKey: ["pms", "cycles"],
    queryFn: () => apiClient.get<PerformanceCycle[]>("/api/cycles"),
    enabled,
  });

  const cycleList = cycles.data ?? [];
  const fallback = [...cycleList].sort((a, b) => b.year - a.year)[0] ?? null;
  const defaultCycle = cycleList.find((c) => c.status === "OPEN") ?? fallback;
  const cycleId = selectedCycleId ?? defaultCycle?.id ?? null;

  const roster = useQuery({
    queryKey: ["pms", "roster", cycleId, query.page, query.pageSize, query.search, query.state],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(query.page),
        pageSize: String(query.pageSize),
      });
      if (query.search) params.set("search", query.search);
      if (query.state) params.set("state", query.state);
      return apiClient.get<RosterResponse>(`/api/cycles/${cycleId}/participants?${params}`);
    },
    enabled: enabled && cycleId !== null,
  });

  return { cycles, cycleList, cycleId, setSelectedCycleId, roster };
}

export default function GoalSettingPage() {
  const t = useTranslations("pms.goalSetting");
  const locale = useLocale();
  const { capabilities, isLoading: actorLoading } = usePmsActor();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");

  // §4.3 — roles are additive and most access wins, so this is an OR, never a
  // switch on a single "primary" role.
  const canDraft = capabilities.lineManager || capabilities.hr;

  const { cycles, cycleList, cycleId, setSelectedCycleId, roster } = useGoalSettingRoster(
    canDraft,
    { page, pageSize, search, state },
  );

  if (actorLoading || (canDraft && cycles.isLoading)) {
    // The page silhouette, not a title over a skeleton: until the actor resolves
    // we do not know whether this user gets a roster or the "not yours" notice.
    return <PageSkeleton rows={6} withAction />;
  }

  if (!canDraft) {
    // §4.2 — drafting and sign-off belong to the direct line manager. Everyone
    // else meets goal setting through their own screens, not through this one.
    return <Notice title={t("title")} description={t("notPermitted")} />;
  }

  if (cycles.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} />
        <LoadFailure onRetry={() => cycles.refetch()} />
      </div>
    );
  }

  if (cycleId === null) {
    return <Notice title={t("title")} subtitle={t("subtitle")} description={t("noCycles")} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <StageBanner stage={roster.data?.stage ?? null} />

      {/* UX P1 (perf-jml P1-7): where each set is in the flow, filtered server-side. */}
      <FilterChips
        label={t("stateFilter")}
        value={state}
        onChange={(value) => {
          setState(value);
          setPage(1);
        }}
        chips={[
          { value: "", label: t("stateAll", { count: roster.data?.total ?? 0 }) },
          ...GOAL_STATES.map((s) => ({ value: s, label: t(`goalState.${s}`) })),
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="cycle-filter" className="text-sm text-muted-foreground">
          {t("cycleLabel")}
        </label>
        <Select
          value={cycleId}
          onValueChange={(value) => {
            setSelectedCycleId(value);
            setPage(1);
          }}
        >
          <SelectTrigger id="cycle-filter" aria-label={t("cycleLabel")} className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {cycleList.map((cycle) => (
              <SelectItem key={cycle.id} value={cycle.id}>
                {cycle.year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <RosterPanel
        roster={roster}
        page={page}
        pageSize={pageSize}
        search={search || state}
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        onPageChange={(nextPage, nextSize) => {
          setPage(nextPage);
          setPageSize(nextSize);
        }}
        hrefFor={(participantId) =>
          `/${locale}/goal-setting/${cycleId}/participants/${participantId}`
        }
      />
    </div>
  );
}

/** The roster's own state triad: skeleton, honest failure, or the table. */
function RosterPanel({
  roster,
  page,
  pageSize,
  search,
  onSearch,
  onPageChange,
  hrefFor,
}: {
  roster: ReturnType<typeof useGoalSettingRoster>["roster"];
  page: number;
  pageSize: number;
  search: string;
  onSearch: (value: string) => void;
  onPageChange: (page: number, pageSize: number) => void;
  hrefFor: (participantId: string) => string;
}) {
  if (roster.isLoading) return <TableSkeleton rows={6} />;
  if (roster.isError) return <LoadFailure onRetry={() => roster.refetch()} />;

  return (
    <ParticipantList
      rows={roster.data?.data ?? []}
      loading={roster.isFetching}
      total={roster.data?.total ?? 0}
      page={page}
      pageSize={pageSize}
      filtered={search.length > 0}
      onSearch={onSearch}
      onPageChange={onPageChange}
      hrefFor={(row) => hrefFor(row.participantId)}
    />
  );
}

/** The screen's error state: name the failure, offer the retry (never a toast). */
function LoadFailure({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("pms.goalSetting");
  return (
    <div className="space-y-3">
      <p role="alert" className="text-sm text-destructive-emphasis">
        {t("loadFailed")}
      </p>
      <Button variant="outline" onClick={onRetry}>
        {t("retry")}
      </Button>
    </div>
  );
}

/** A whole-page explanation — nothing to work on here, and why. */
function Notice({
  title,
  subtitle,
  description,
}: {
  title: string;
  subtitle?: string;
  description: string;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} subtitle={subtitle} />
      <SectionCard title={title}>
        <EmptyState description={description} />
      </SectionCard>
    </div>
  );
}
