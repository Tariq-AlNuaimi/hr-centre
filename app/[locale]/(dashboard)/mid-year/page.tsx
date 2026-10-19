"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageSkeleton, TableSkeleton } from "@/components/shared/Skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PerformanceCycle } from "@/components/pms/CycleList";
import type { RosterResponse } from "@/components/pms/ParticipantList";
import { MidYearRoster } from "@/components/pms/MidYearRoster";
import { MyMidYear } from "@/components/pms/MyMidYear";
import { StageBanner } from "@/components/pms/StageBanner";
import { usePmsActor } from "@/hooks/use-pms-actor";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

/**
 * `stageState` from `lib/pms/cycle.ts` takes `Date`s and lives server-side; the
 * cycle list delivers ISO strings. Same three-way answer, same boundaries —
 * exactly at the deadline is still OPEN (§5.4).
 */
function stageStateFor(opensAt: string, deadline: string) {
  const now = Date.now();
  if (now < Date.parse(opensAt)) return "NOT_YET_OPEN" as const;
  if (now > Date.parse(deadline)) return "LOCKED" as const;
  return "OPEN" as const;
}

/**
 * Mid-year review — the §6 workspace.
 *
 * Same archetype as goal setting, one year later in the cycle: the stage window
 * first (§5.4's hard lock, stated rather than discovered on submit), then what
 * is waiting on this person, then the roster.
 *
 * WHAT IS DIFFERENT FROM GOAL SETTING. §2 is explicit that mid-year carries **no
 * scoring**; the only thing that happens here is §6's change requests. So the
 * roster links to the change-request screen, not the drafting board, and the
 * panel above it is a queue — HR sees what needs deciding, a manager sees what
 * they have asked for and not yet had answered.
 *
 * WHO SEES THIS. §4.2 reserves raising a request for the DIRECT line manager and
 * §4.1 gives HR the org-wide override, so the nav entry asks the same question
 * the routes ask. An affordance, never a control: every route re-checks.
 */

interface ChangeRequestSummary {
  id: string;
  participantId: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  rationale: string;
  requestedAt: string;
  requestedByEmployee: { id: string; name: string } | null;
  edits: { kpiId: string }[];
}

/**
 * The three queries this screen runs, and the cycle they hang off.
 *
 * Extracted for the same reason `useGoalSettingRoster` was: a page component
 * that both derives its own selection and renders four distinct states crosses
 * the complexity budget, and the honest seam is between DECIDING what to fetch
 * and RENDERING what came back.
 */
function useMidYearWorkspace(
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

  const pending = useQuery({
    queryKey: ["pms", "change-requests", "pending"],
    queryFn: () =>
      apiClient.get<{ data: ChangeRequestSummary[]; total: number }>(
        "/api/kpi-change-requests?status=PENDING&pageSize=50",
      ),
    enabled,
  });

  return { cycles, cycleList, cycleId, selected, setSelectedCycleId, roster, pending };
}

export default function MidYearPage() {
  const t = useTranslations("pms.midYear");
  const locale = useLocale();
  const { actor, capabilities, isLoading: actorLoading } = usePmsActor();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");

  const roles = actor?.pmsRoles ?? [];
  // §4.3 — roles are additive and most access wins, so this is an OR, never a
  // switch on a single "primary" role.
  const canWork =
    capabilities.lineManager || roles.includes("HR_SUPER_ADMIN") || roles.includes("HRBP");

  const { cycles, cycleList, cycleId, selected, setSelectedCycleId, roster, pending } =
    useMidYearWorkspace(canWork, { page, pageSize, search });

  if (actorLoading || (canWork && cycles.isLoading)) {
    // The page silhouette: until the actor resolves we do not know whether this
    // user gets a roster or the "not yours" notice.
    return <PageSkeleton rows={6} withAction />;
  }

  if (!canWork) {
    // §6.2 — an employee's own mid-year review. This used to be a "not
    // permitted" notice, which was true of the manager's roster and wrong about
    // §6 as a whole: a change to someone's goals is now something they see and
    // acknowledge, so the screen they land on is theirs, not a refusal.
    return (
      <div className="space-y-6">
        <PageHeader title={t("myTitle")} subtitle={t("mySubtitle")} />
        <MyMidYear />
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

  const stage = selected?.stages.find((s) => s.kind === "MID_YEAR");
  const midYearStage = stage
    ? { ...stage, state: stageStateFor(stage.opensAt, stage.deadline) }
    : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {/* The MID-YEAR stage, read off the cycle. The roster endpoint reports the
          GOAL-SETTING window — it is the goal-setting roster — and feeding that
          into this banner told a manager the mid-year window was unconfigured
          while it was open. §5.4's lock is per stage, so the banner has to name
          the same one the route will check. */}
      <StageBanner stage={midYearStage} namespace="pms.midYear.stage" />

      <PendingQueue query={pending} cycleId={cycleId} locale={locale} />

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
          hrefFor={(row) => `/${locale}/mid-year/${cycleId}/participants/${row.participantId}`}
        />
      )}
    </div>
  );
}

/**
 * What is waiting on a decision — §6.2's queue.
 *
 * Its own component because the page crossed the complexity budget with it
 * inline, and the seam is real rather than arbitrary: this panel answers "what
 * needs me", the roster below answers "who is in this cycle", and they load
 * independently. Loading, empty and populated are all rendered honestly — an
 * empty queue is a real answer, not a spinner that never resolves.
 */
function PendingQueue({
  query,
  cycleId,
  locale,
}: {
  query: UseQueryResult<{ data: ChangeRequestSummary[]; total: number }>;
  cycleId: string;
  locale: string;
}) {
  const t = useTranslations("pms.midYear");
  const queue = query.data?.data ?? [];

  return (
    <SectionCard title={t("queueTitle")} subtitle={t("queueSubtitle")}>
      {query.isLoading ? <TableSkeleton rows={3} /> : null}
      {!query.isLoading && queue.length === 0 ? <EmptyState description={t("queueEmpty")} /> : null}
      {queue.length > 0 ? (
        <ul className="space-y-3">
          {queue.map((request) => (
            <li
              key={request.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="min-w-0 space-y-1">
                <p className="text-sm text-foreground">{request.rationale}</p>
                <p className="text-xs text-muted-foreground">
                  {t("queueMeta", {
                    name: request.requestedByEmployee?.name ?? t("unknownRequester"),
                    count: request.edits.length,
                    datetime: formatDateTime(request.requestedAt),
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="warning">{t(`status.${request.status}`)}</Badge>
                <Link
                  href={`/${locale}/mid-year/${cycleId}/participants/${request.participantId}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  {t("open")}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </SectionCard>
  );
}
