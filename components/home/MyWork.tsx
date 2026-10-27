"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { MyNotices, usePmsTasks, type PmsTaskList } from "@/components/pms/MyTasksOversight";
import { apiClient } from "@/lib/api-client";
import {
  dueGroup,
  type DueGroup,
  type WorkItem,
  type WorkList,
  type WorkModule,
} from "@/lib/core/work-items";
import { formatDate } from "@/lib/format";

/**
 * Home's ONE list of what is waiting on the viewer (docs/blueprints/ux-p0.md,
 * US-1): Performance tasks (built on the client from the Performance reads)
 * plus Joiners & leavers, Hiring and HR tickets (`GET /api/work-items`), grouped
 * Overdue / This week / Later, each with its module and a link.
 *
 * Honest states: a module that could not be read is NAMED ("couldn't load
 * Hiring"), never folded into "nothing is waiting"; a capped module says so.
 */

type Row = {
  key: string;
  module: WorkModule;
  title: string;
  detail: string | null;
  /** Why it cannot be acted on now; a blocked row has no action button. */
  blocked: string | null;
  dueAt: string | null;
  group: DueGroup;
  href: string;
  action: string;
};

const GROUPS: DueGroup[] = ["overdue", "thisWeek", "later"];
const GROUP_VARIANT: Record<DueGroup, BadgeProps["variant"]> = {
  overdue: "danger",
  thisWeek: "warning",
  later: "outline",
};

function useNowMs(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  return now;
}

function usePmsRows(pms: PmsTaskList, nowMs: number): Row[] {
  const t = useTranslations("pms.home");
  return pms.tasks.map((task) => {
    const tone = task.tone ?? pms.tone;
    const dueAt = task.dueAt ?? pms.stage?.deadline ?? null;
    const group: DueGroup =
      tone === "overdue"
        ? "overdue"
        : tone === "dueSoon"
          ? "thisWeek"
          : tone === "notYetOpen"
            ? "later"
            : dueGroup(dueAt, nowMs);
    return {
      key: `pms:${task.key}`,
      module: "performance",
      title: t(task.titleKey, task.titleParams),
      detail: t(task.detailKey, task.detailParams),
      blocked: task.blockedReason,
      dueAt,
      group,
      href: task.href,
      action: t(task.actionKey),
    };
  });
}

function useServerRows(items: readonly WorkItem[], nowMs: number): Row[] {
  const t = useTranslations("work");
  const locale = useLocale();
  return items.map((item) => ({
    key: item.key,
    module: item.module,
    title: t(`kind.${item.kind}`, item.params),
    detail: null,
    blocked: null,
    dueAt: item.dueAt,
    group: dueGroup(item.dueAt, nowMs),
    href: `/${locale}${item.href}`,
    action: t("open"),
  }));
}

function WorkRow({ row }: { row: Row }) {
  const t = useTranslations("work");
  const tc = useTranslations("pms.home");
  const due =
    row.dueAt === null
      ? t("noDue")
      : row.group === "overdue"
        ? t("overdueSince", { date: formatDate(row.dueAt) })
        : t("dueOn", { date: formatDate(row.dueAt) });
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="brand">{t(`module.${row.module}`)}</Badge>
          <span className="text-sm font-medium text-foreground">{row.title}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          <Badge variant={GROUP_VARIANT[row.group]} className="me-2">
            {due}
          </Badge>
          {row.detail}
        </p>
        {row.blocked ? (
          <>
            <p className="max-w-prose text-xs text-muted-foreground">{row.blocked}</p>
            <p className="max-w-prose text-xs text-muted-foreground">{tc("blockedContact")}</p>
          </>
        ) : null}
      </div>
      {/* A blocked task has nothing to start: no button beside "nothing to assess". */}
      {row.blocked ? null : (
        <Link href={row.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
          {row.action}
        </Link>
      )}
    </li>
  );
}

function WorkGroups({ rows }: { rows: Row[] }) {
  const t = useTranslations("work");
  return (
    <div className="space-y-5">
      {GROUPS.map((g) => {
        const inGroup = rows.filter((r) => r.group === g);
        if (inGroup.length === 0) return null;
        return (
          <section key={g} aria-labelledby={`work-${g}`}>
            <h3 id={`work-${g}`} className="m-0 text-sm font-semibold text-foreground">
              {t(`group.${g}`, { count: inGroup.length })}
            </h3>
            <ul className="m-0 list-none p-0">
              {inGroup.map((row) => (
                <WorkRow key={row.key} row={row} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Modules whose list was capped: "showing 20 of 34 in Hiring". */
function capped(list: WorkList | undefined): Array<{ module: WorkModule; total: number }> {
  if (!list) return [];
  const shown = new Map<WorkModule, number>();
  for (const i of list.items) shown.set(i.module, (shown.get(i.module) ?? 0) + 1);
  return (Object.entries(list.totals) as Array<[WorkModule, number]>)
    .filter(([m, total]) => total > (shown.get(m) ?? 0))
    .map(([module, total]) => ({ module, total }));
}

export function MyWork() {
  const t = useTranslations("work");
  const nowMs = useNowMs() ?? 0;
  const pms = usePmsTasks();
  const server = useQuery({
    queryKey: ["work-items"],
    queryFn: () => apiClient.get<WorkList>("/api/work-items"),
  });
  const pmsRows = usePmsRows(pms, nowMs);
  const serverRows = useServerRows(server.data?.items ?? [], nowMs);
  const rows = [...pmsRows, ...serverRows].sort((a, b) =>
    a.dueAt === b.dueAt
      ? 0
      : a.dueAt === null
        ? 1
        : b.dueAt === null
          ? -1
          : a.dueAt < b.dueAt
            ? -1
            : 1,
  );
  const failed: WorkModule[] = [
    ...(pms.failed ? (["performance"] as const) : []),
    ...(server.isError ? (["jml", "hiring", "tickets"] as const) : (server.data?.failed ?? [])),
  ];
  const loading = pms.loading || server.isLoading;

  return (
    <SectionCard title={t("title")} subtitle={t("subtitle")}>
      <div className="space-y-4">
        {/* Above the list on purpose: a notice must show when the list is empty,
            loading or unavailable — those are the mornings it matters. */}
        <MyNotices />
        {failed.length ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-destructive-emphasis">
              {t("failed", { modules: failed.map((m) => t(`module.${m}`)).join(", ") })}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                pms.refetch();
                void server.refetch();
              }}
            >
              {t("retry")}
            </Button>
          </div>
        ) : null}
        {loading ? (
          <TableSkeleton rows={3} />
        ) : rows.length === 0 && failed.length === 0 ? (
          <EmptyState description={t("empty")} />
        ) : (
          <WorkGroups rows={rows} />
        )}
        {capped(server.data).map((c) => (
          <p key={c.module} className="text-xs text-muted-foreground">
            {t("capped", { module: t(`module.${c.module}`), total: c.total })}
          </p>
        ))}
        {pms.truncation ? (
          <p className="text-xs text-muted-foreground">{t("cappedPerformance", pms.truncation)}</p>
        ) : null}
      </div>
    </SectionCard>
  );
}
