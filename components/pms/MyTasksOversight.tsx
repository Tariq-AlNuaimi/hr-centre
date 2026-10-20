"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Building2, Eye, Network, Users } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import type { PerformanceCycle } from "@/components/pms/CycleList";
import type { ParticipantRow, RosterResponse } from "@/components/pms/ParticipantList";
import type { GoalStage } from "@/components/pms/StageBanner";
import { NotificationList } from "@/components/pms/NotificationList";
import { useNotifications } from "@/hooks/use-notifications";
import { usePmsActor, type PmsCapabilities } from "@/hooks/use-pms-actor";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * §4.4 — "Every user's interface separates: **My Tasks** (personal action
 * space): everything assigned to me to do, regardless of which role generated
 * it… Driven by assignment, not hierarchy or role name. **Oversight** (view
 * space): everything I'm entitled to see but not necessarily act on."
 *
 * Three properties the split has to have, and how each is made true here:
 *
 *   ONE OF EACH, NOT ONE PER ROLE. §4.3 makes PMS roles additive ("most access
 *   wins"), so an HRBP who also manages three people gets ONE My Tasks holding
 *   her own signature and her three reports' drafts, and ONE Oversight holding
 *   both the org-wide view and her chain. Nothing here is keyed on a "primary"
 *   role, because there is no such thing.
 *
 *   ASSIGNMENT, NOT HIERARCHY. A row lands in My Tasks because of what it is
 *   waiting on — my signature, my drafting — never because of what I am called.
 *   The predicates are `employee.id === me` and `employee.managerId === me`,
 *   which is exactly the edge §4.2 reserves to the direct line manager.
 *
 *   URGENCY IS THE ORDER. §5.4 makes the stage deadline a hard lock, so tasks
 *   sort against it: a locked stage first (it is already too late, and that has
 *   to be visible rather than discovered on submit), then a deadline inside
 *   three days, then the rest — and within a band, the set with nothing drafted
 *   before the one that only needs a signature.
 *
 * ASSIGNMENT IS THE FILTER, AND IT IS THE SERVER'S. `scope=mine` returns exactly
 * my own set plus the sets I owe a manager's action on. This used to assemble
 * the list client-side from a page of the whole roster plus a name lookup for
 * the viewer's own row, because no such filter existed — exact for a 37-person
 * fixture and silently wrong at 500, where a person's own signature falls off
 * page 2 and their task list quietly loses entries. The pagination notice below
 * survives for the rare manager whose own assignments outrun one page.
 *
 * The ranking logic lives in `lib/pms/tasks.ts`: it is pure, it crossed the
 * complexity budget in here, and "whose turn is it, and how late" is exactly
 * what a test can check and a screenshot cannot.
 */

import {
  buildTasks,
  toneForStage,
  CLOCK_TICK_MS,
  STAGE_RANK,
  type Task,
  type TaskTone,
  buildThreeSixtyTasks,
  buildYearEndTasks,
  type ThreeSixtyTaskRow,
  type YearEndTaskState,
} from "@/lib/pms/tasks";

function useNowMs(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const read = () => setNow(Date.now());
    const first = setTimeout(read, 0);
    const timer = setInterval(read, CLOCK_TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  return now;
}

/** Rows per roster page — the API's own ceiling (`parsePagination`). */
const ROSTER_PAGE_SIZE = 100;
const TONE_VARIANT: Record<TaskTone, BadgeProps["variant"]> = {
  overdue: "danger",
  dueSoon: "warning",
  notYetOpen: "outline",
  open: "success",
};

/** The queries behind both sections, kept in one place so they stay in step. */
function useGoalSettingSnapshot(wantsEntitledCount: boolean) {
  const cycles = useQuery({
    queryKey: ["pms", "cycles"],
    queryFn: () => apiClient.get<PerformanceCycle[]>("/api/cycles"),
  });

  // §2 — one cycle per year, and exactly one of them is the year being run.
  const openCycle = (cycles.data ?? []).find((c) => c.status === "OPEN") ?? null;

  // §4.4 — "driven by assignment, not hierarchy or role name". `scope=mine` is
  // that filter, server-side: my own set plus the sets I owe a manager's action
  // on, and nothing else.
  //
  // This was assembled client-side from a page of the whole roster plus a
  // targeted name lookup, because no such filter existed. That is exact for a
  // 37-person fixture and silently wrong at 500: the viewer's own row falls off
  // page 2 and their task list quietly loses entries — the worst failure mode a
  // task list has, because nothing looks broken. One request now, and the count
  // is the truth rather than a sample.
  const roster = useQuery({
    queryKey: ["pms", "home-roster", openCycle?.id, "mine"],
    queryFn: () =>
      apiClient.get<RosterResponse>(
        `/api/cycles/${openCycle?.id}/participants?page=1&pageSize=${ROSTER_PAGE_SIZE}&scope=mine`,
      ),
    enabled: openCycle !== null,
  });

  // The oversight cards claim ENTITLEMENT — "every participant in the cycle",
  // "your whole chain" — which is a different question from `scope=mine` above,
  // and answering it with the task scope was wrong by a wide margin: an HR Super
  // Admin who line-manages nobody has exactly one assigned set, so the card that
  // says "the whole organisation" read "1 Participants in view" against 37.
  //
  // Omitting `scope` is precisely the §4.1/§4.2 visibility set the cards
  // describe, and `pageSize=1` buys the `total` without the rows: the count is
  // the whole point of the read, the page is not.
  const entitledCount = useQuery({
    queryKey: ["pms", "home-entitled-count", openCycle?.id],
    queryFn: () =>
      apiClient.get<RosterResponse>(`/api/cycles/${openCycle?.id}/participants?page=1&pageSize=1`),
    enabled: openCycle !== null && wantsEntitledCount,
  });

  const byId = new Map<string, ParticipantRow>();
  for (const row of roster.data?.data ?? []) {
    byId.set(row.participantId, row);
  }

  return {
    cycles,
    roster,
    entitledCount,
    openCycle,
    rows: [...byId.values()],
    isLoading: cycles.isLoading || (openCycle !== null && roster.isLoading),
    // The count's failure is surfaced, not swallowed: hiding the number silently is
    // the same dishonest-state failure the count bug itself was.
    isError: cycles.isError || roster.isError || entitledCount.isError,
    refetch: () => {
      cycles.refetch();
      roster.refetch();
      // `refetch()` ignores `enabled`, so re-check the predicate by hand — otherwise
      // Retry fires a request for a viewer with no card to show it in, and with no
      // open cycle it would hit `/api/cycles/undefined/participants`.
      if (openCycle !== null && wantsEntitledCount) entitledCount.refetch();
    },
  };
}

function TaskRow({ task, tone, stage }: { task: Task; tone: TaskTone; stage: GoalStage | null }) {
  const t = useTranslations("pms.home");

  // A task with its own deadline (§4.4's 360 rows) speaks for itself; the KPI
  // rows still take the goal-setting stage's, which is the only deadline they
  // have.
  const rowTone = task.tone ?? tone;
  const rowDeadline = task.dueAt ?? stage?.deadline ?? null;

  const dueLabel =
    rowTone === "overdue"
      ? t("overdue")
      : rowTone === "dueSoon"
        ? t("dueSoon")
        : rowTone === "open" && rowDeadline
          ? t("dueLabel", { datetime: formatDateTime(rowDeadline) })
          : t("notYetOpen");

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4 last:border-b-0 last:pb-0">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {t(task.titleKey, task.titleParams)}
          </span>
          <Badge variant={TONE_VARIANT[rowTone]}>{dueLabel}</Badge>
        </div>
        <p className="max-w-prose text-xs text-muted-foreground">
          {t(task.detailKey, task.detailParams)}
        </p>
        {/* The server's own sentence, quoted: it names WHICH rule closed the
            door (§4.2 / §5.4 / §5.1). */}
        {task.blockedReason ? (
          <p className="max-w-prose text-xs text-muted-foreground">{task.blockedReason}</p>
        ) : null}
      </div>
      <Link href={task.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
        {t(task.actionKey)}
      </Link>
    </li>
  );
}

/** How many unread notices the dashboard shows before deferring to the bell. */
const DASHBOARD_NOTICES = 5;

/**
 * Unread notices, above the task list and visibly NOT part of it.
 *
 * §4.4 splits the interface into "everything assigned to me to do" and
 * "everything I'm entitled to see". A notification is neither: it is what I was
 * TOLD. It sits inside the My Tasks card because that is where people look
 * first and an escalation that waits to be discovered has failed at its one
 * job — but it is a separate, labelled block, because listing "your report's
 * manager missed a deadline" among a person's own tasks would claim it is
 * theirs to do.
 *
 * Read ones are not shown here at all. The bell keeps the history; the
 * dashboard shows only what is new, or the block would grow into a second,
 * worse task list.
 */
function MyNotices() {
  // Named apart from the file's other `t` on purpose: this block reads a
  // DIFFERENT namespace, and one variable bound to two namespaces in one file
  // is how a key silently renders as its own name (tests/contracts/i18n-keys).
  const tn = useTranslations("pms.notifications");
  const { items, unread, markRead } = useNotifications();
  const unreadItems = items.filter((i) => i.readAt === null).slice(0, DASHBOARD_NOTICES);
  if (unreadItems.length === 0) return null;

  return (
    <section aria-labelledby="my-notices" className="rounded-md border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h3 id="my-notices" className="text-sm font-medium text-foreground">
          {tn("dashboardTitle")}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => markRead.mutate({ all: true })}
          disabled={markRead.isPending}
        >
          {tn("markAllRead")}
        </Button>
      </div>
      <NotificationList items={unreadItems} onOpen={(id) => markRead.mutate({ ids: [id] })} />
      {unread > unreadItems.length ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {tn("moreInBell", { count: unread - unreadItems.length })}
        </p>
      ) : null}
    </section>
  );
}

function MyTasksBody(props: {
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  hasEmployeeRecord: boolean;
  openYear: number | null;
  tasks: Task[];
  tone: TaskTone;
  stage: GoalStage | null;
  truncation: { shown: number; total: number } | null;
}) {
  const t = useTranslations("pms.home");
  const tGoal = useTranslations("pms.goalSetting");

  if (props.loading) return <TableSkeleton rows={3} />;
  if (props.failed) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-destructive-emphasis">
          {t("loadFailed")}
        </p>
        <Button variant="outline" onClick={props.onRetry}>
          {t("retry")}
        </Button>
      </div>
    );
  }
  if (!props.hasEmployeeRecord) return <EmptyState description={t("noEmployeeRecord")} />;
  if (props.openYear === null) return <EmptyState description={t("noOpenCycle")} />;
  if (props.tasks.length === 0) {
    return <EmptyState description={t("empty", { year: props.openYear })} />;
  }

  return (
    <div className="space-y-4">
      {props.truncation ? (
        <p className="text-xs text-muted-foreground">{tGoal("truncated", props.truncation)}</p>
      ) : null}
      <ul className="flex list-none flex-col gap-4 p-0">
        {props.tasks.map((task) => (
          <TaskRow key={task.key} task={task} tone={props.tone} stage={props.stage} />
        ))}
      </ul>
    </div>
  );
}

/**
 * One entitlement, stated as what it lets the viewer SEE. Not a nested Card — a
 * bordered peer in a grid of ≥2, which is the density rule's one sanctioned use
 * of a card-shaped surface.
 */
function OversightCard(props: {
  icon: ReactNode;
  title: string;
  body: string;
  actionLabel?: string;
  href?: string;
  value?: number | null;
  valueLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-muted-foreground">{props.icon}</span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">{props.title}</p>
          <p className="text-xs text-muted-foreground">{props.body}</p>
        </div>
      </div>
      {props.value != null && props.valueLabel ? (
        <div className="flex items-baseline gap-2">
          <span className="text-h5 font-semibold text-foreground">{props.value}</span>
          <span className="text-xs text-muted-foreground">{props.valueLabel}</span>
        </div>
      ) : null}
      {props.actionLabel && props.href ? (
        <Link
          href={props.href}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}
        >
          {props.actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

function RoleBadges({ roles, isLineManager }: { roles: string[]; isLineManager: boolean }) {
  const t = useTranslations("pms.home");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">{t("myRolesTitle")}</span>
      {roles.length === 0 && !isLineManager ? (
        <Badge variant="outline">{t("noPmsRoles")}</Badge>
      ) : null}
      {roles.map((role) => (
        <Badge key={role} variant="brand">
          {t(`roleValue.${role}`)}
        </Badge>
      ))}
      {isLineManager ? <Badge variant="brand">{t("roleValue.LINE_MANAGER")}</Badge> : null}
    </div>
  );
}

function OversightBody({
  capabilities,
  locale,
  visible,
}: {
  capabilities: PmsCapabilities;
  locale: string;
  visible: number | null;
}) {
  const t = useTranslations("pms.home");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {capabilities.lineManager ? (
        <OversightCard
          icon={<Network aria-hidden className="h-4 w-4" />}
          title={t("chainTitle")}
          body={t("chainBody")}
          actionLabel={t("chainAction")}
          href={`/${locale}/goal-setting`}
          value={visible}
          valueLabel={t("participantsCount", { count: visible ?? 0 })}
        />
      ) : null}

      {capabilities.orgWide && !capabilities.readOnly ? (
        <OversightCard
          icon={<Building2 aria-hidden className="h-4 w-4" />}
          title={t("orgTitle")}
          body={t("orgBody")}
          actionLabel={t("orgAction")}
          href={`/${locale}/admin/cycles`}
          value={visible}
          valueLabel={t("participantsCount", { count: visible ?? 0 })}
        />
      ) : null}

      {capabilities.readOnly ? (
        // §4.1 — the executive viewer sees everything and acts on nothing, so
        // this card deliberately carries no action.
        <OversightCard
          icon={<Eye aria-hidden className="h-4 w-4" />}
          title={t("readOnlyTitle")}
          body={t("readOnlyBody")}
          value={visible}
          valueLabel={t("participantsCount", { count: visible ?? 0 })}
        />
      ) : null}

      <OversightCard
        icon={<Users aria-hidden className="h-4 w-4" />}
        title={t("directoryTitle")}
        body={t("directoryBody")}
        actionLabel={t("directoryAction")}
        href={`/${locale}/people`}
      />
    </div>
  );
}

export function MyTasksOversight() {
  const t = useTranslations("pms.home");
  const locale = useLocale();
  const nowMs = useNowMs();
  const { actor, capabilities, isLoading: actorLoading, isError: actorError } = usePmsActor();
  // Only the three capability-gated oversight cards below display a count, so only
  // they are worth a request for one. A plain employee sees the directory card alone
  // and pays nothing.
  const snapshot = useGoalSettingSnapshot(
    capabilities.lineManager || capabilities.orgWide || capabilities.readOnly,
  );

  const stage = snapshot.roster.data?.stage ?? null;
  const tone = toneForStage(stage, nowMs);

  const kpiTasks = buildTasks({
    rows: snapshot.rows,
    employeeId: actor?.employeeId ?? null,
    stageRank: STAGE_RANK[tone],
    hrefFor: (row) =>
      `/${locale}/goal-setting/${snapshot.openCycle?.id}/participants/${row.participantId}`,
    locale,
  });

  // §4.4 — "any 360 assigned to me (report, peer, or colleague)". Driven by
  // assignment, so it is a separate read from the goal-setting roster: a rater
  // may hold a 360 for someone who is not their report and never appears in it.
  const myThreeSixty = useQuery({
    queryKey: ["pms", "360", "mine"],
    queryFn: () =>
      apiClient.get<{ assignments: ThreeSixtyTaskRow[] }>("/api/three-sixty/assignments"),
    enabled: !!actor?.employeeId,
  });

  // §7.1 — the employee's own year-end self-assessment. Its own read, for the
  // same reason the 360 one is: it is driven by the caller's participation, not
  // by the goal-setting roster, which a plain employee never fetches at all.
  const myYearEnd = useQuery({
    queryKey: ["pms", "year-end", "me"],
    queryFn: () => apiClient.get<YearEndTaskState>("/api/year-end/me"),
    enabled: !!actor?.employeeId,
  });

  const tasks = [
    ...kpiTasks,
    ...buildThreeSixtyTasks({
      assignments: myThreeSixty.data?.assignments ?? [],
      hrefFor: (a) => `/${locale}/three-sixty/assignments/${a.id}`,
      nowMs,
    }),
    ...buildYearEndTasks({
      mine: myYearEnd.data,
      href: `/${locale}/year-end`,
      nowMs,
    }),
  ].sort((a, b) => a.rank - b.rank);

  const rosterData = snapshot.roster.data;
  const truncation =
    rosterData && rosterData.totalPages > 1
      ? { shown: rosterData.data.length, total: rosterData.total }
      : null;

  return (
    <>
      <SectionCard title={t("myTasksTitle")} subtitle={t("myTasksSubtitle")}>
        {/* Above the list, and outside MyTasksBody on purpose: a notice must
            still show when the task list is empty, loading, or unavailable —
            those are exactly the mornings an escalation matters. */}
        <div className="space-y-4">
          <MyNotices />
          <MyTasksBody
            loading={actorLoading || snapshot.isLoading}
            failed={actorError || snapshot.isError}
            onRetry={snapshot.refetch}
            hasEmployeeRecord={!!actor?.employeeId}
            openYear={snapshot.openCycle?.year ?? null}
            tasks={tasks}
            tone={tone}
            stage={stage}
            truncation={truncation}
          />
        </div>
      </SectionCard>

      <SectionCard
        title={t("oversightTitle")}
        subtitle={t("oversightSubtitle")}
        actions={
          <RoleBadges roles={actor?.pmsRoles ?? []} isLineManager={capabilities.lineManager} />
        }
      >
        <OversightBody
          capabilities={capabilities}
          locale={locale}
          visible={snapshot.entitledCount.data?.total ?? null}
        />
      </SectionCard>
    </>
  );
}
