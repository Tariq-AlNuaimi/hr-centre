"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { MyYearEnd } from "@/components/pms/MyYearEnd";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageSkeleton, TableSkeleton } from "@/components/shared/Skeletons";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CycleStage, PerformanceCycle } from "@/components/pms/CycleList";
import type { RosterResponse } from "@/components/pms/ParticipantList";
import { MidYearRoster } from "@/components/pms/MidYearRoster";
import { StageBanner } from "@/components/pms/StageBanner";
import { usePmsActor } from "@/hooks/use-pms-actor";
import { apiClient } from "@/lib/api-client";

/**
 * Year-end assessment — the §7 workspace.
 *
 * Same archetype as goal-setting and mid-year, at the third of §2's touchpoints:
 * the stage window first (§5.4's hard lock, stated rather than discovered on
 * submit), a year picker, then the roster — each row linking to that
 * participant's assessment.
 *
 * WHO SEES THIS. §7.1 gives the two actions to the employee (their own
 * self-assessment) and their DIRECT line manager (the review), with §4.1's
 * org-wide HR override. An employee with no reports reaches their own
 * assessment through My Tasks on the home page rather than through a roster
 * that would show them one row — so this screen is for managers and HR, and it
 * is an affordance, never a control: every route re-checks.
 */

/**
 * `stageState` from `lib/pms/cycle.ts` takes `Date`s and runs server-side; the
 * cycle list delivers ISO strings. Same three-way answer, same boundaries —
 * exactly at the deadline is still OPEN (§5.4).
 */
function stageStateFor(opensAt: string, deadline: string) {
  const now = Date.now();
  if (now < Date.parse(opensAt)) return "NOT_YET_OPEN" as const;
  if (now > Date.parse(deadline)) return "LOCKED" as const;
  return "OPEN" as const;
}

function useYearEndWorkspace(
  enabled: boolean,
  query: { page: number; pageSize: number; search: string },
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
  const selected = cycleList.find((c) => c.id === selectedCycleId) ?? defaultCycle;
  const cycleId = selected?.id ?? null;

  const roster = useQuery({
    queryKey: ["pms", "roster", cycleId, query.page, query.pageSize, query.search],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(query.page),
        pageSize: String(query.pageSize),
      });
      if (query.search) params.set("search", query.search);
      return apiClient.get<RosterResponse>(`/api/cycles/${cycleId}/participants?${params}`);
    },
    enabled: enabled && cycleId !== null,
  });

  return { cycles, cycleList, cycleId, selected, setSelectedCycleId, roster };
}

export default function YearEndPage() {
  const t = useTranslations("pms.yearEnd");
  const locale = useLocale();
  const { capabilities, isLoading: actorLoading } = usePmsActor();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");

  // §4.3 — roles are additive and most access wins, so this is an OR.
  const canWork = capabilities.lineManager || capabilities.hr;

  const { cycles, cycleList, cycleId, selected, setSelectedCycleId, roster } = useYearEndWorkspace(
    canWork,
    { page, pageSize, search },
  );

  if (actorLoading || (canWork && cycles.isLoading)) return <PageSkeleton rows={6} withAction />;

  if (!canWork) {
    // §7.1 — an employee's OWN year-end assessment. This used to be a "not
    // permitted" notice whose copy pointed at a My Tasks card that was never
    // built, so §7.1's first step — the employee self-assessing — was reachable
    // only by guessing a participant URL. The roster is what they may not see;
    // their own assessment was never the thing being refused.
    return (
      <div className="space-y-6">
        <PageHeader title={t("myTitle")} subtitle={t("mySubtitle")} />
        <MyYearEnd />
      </div>
    );
  }

  if (cycles.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} />
        <div className="space-y-3">
          <p role="alert" className="text-sm text-destructive-emphasis">
            {t("loadFailed")}
          </p>
          <Button variant="outline" onClick={() => cycles.refetch()}>
            {t("retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (cycleId === null) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <SectionCard title={t("title")}>
          <EmptyState description={t("noCycles")} />
        </SectionCard>
      </div>
    );
  }

  const stage: CycleStage | undefined = selected?.stages.find((s) => s.kind === "YEAR_END");

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {/* §7.1 — a manager is almost always somebody's report as well, and their
          OWN assessment is theirs alone to write. Rendering this only in the
          `!canWork` branch would hand every manager and HR user a screen they
          could not reach — the mistake §6.2's mid-year screen made and had to
          be corrected for a day earlier. It renders nothing when they have
          nothing of their own, so the roster stays the page for everyone else. */}
      <MyYearEnd variant="summary" />

      {/* The YEAR-END window, read off the cycle. The roster endpoint reports the
          GOAL-SETTING one — it is the goal-setting roster — and §5.4's lock is
          per stage, so the banner must name the same stage the route checks. */}
      <StageBanner
        stage={stage ? { ...stage, state: stageStateFor(stage.opensAt, stage.deadline) } : null}
        namespace="pms.yearEnd.stage"
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

      {roster.isLoading ? (
        <TableSkeleton rows={6} />
      ) : (
        <MidYearRoster
          rows={roster.data?.data ?? []}
          loading={roster.isFetching}
          total={roster.data?.total ?? 0}
          page={page}
          pageSize={pageSize}
          filtered={search.length > 0}
          onSearch={(value) => {
            setSearch(value);
            setPage(1);
          }}
          onPageChange={(nextPage, nextSize) => {
            setPage(nextPage);
            setPageSize(nextSize);
          }}
          hrefFor={(row) => `/${locale}/year-end/${cycleId}/participants/${row.participantId}`}
        />
      )}
    </div>
  );
}
