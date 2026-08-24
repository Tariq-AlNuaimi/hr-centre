"use client";

import { useTranslations } from "next-intl";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/format";

/**
 * The performance-cycle list — spec §2 (cadence, one cycle per year) and §5.4
 * (a deadline is a hard lock).
 *
 * List archetype on the shared DataTable. Two things this table deliberately
 * makes visible rather than tidy:
 *
 *   1. Each stage cell shows the deadline WITH ITS TIME. §5.4 stops the relevant
 *      party acting the moment a deadline passes, so "31 December" alone is not
 *      an honest label for an instant — HR needs to see that it lands at 23:59.
 *   2. The lifecycle is one-way (DRAFT → OPEN → CLOSED). A closed cycle is
 *      therefore offered NO control at all, rather than a reopen button that the
 *      route would answer with a 409. A dead control is worse than an absent one.
 */

export type CycleStageKind = "GOAL_SETTING" | "MID_YEAR" | "YEAR_END";
export type CycleStatus = "DRAFT" | "OPEN" | "CLOSED";

/** §2's three touchpoints, in the order the year runs them. */
export const STAGE_ORDER: readonly CycleStageKind[] = ["GOAL_SETTING", "MID_YEAR", "YEAR_END"];

export interface CycleStage {
  id: string;
  kind: CycleStageKind;
  /** ISO instants — the API stores and returns real instants, not calendar days. */
  opensAt: string;
  deadline: string;
  graceDays: number;
}

export interface PerformanceCycle {
  id: string;
  year: number;
  status: CycleStatus;
  openedAt: string | null;
  openedBy: { id: string; name: string } | null;
  stages: CycleStage[];
  _count: { participants: number };
}

/** DRAFT is neutral (nothing is live yet), OPEN is the running year, CLOSED is done. */
const STATUS_TONE: Record<CycleStatus, BadgeProps["variant"]> = {
  DRAFT: "outline",
  OPEN: "success",
  CLOSED: "default",
};

interface CycleListProps {
  cycles: PerformanceCycle[];
  loading?: boolean;
  /** False for a viewer who may read the cycles but not run them (§4.1). */
  canManage: boolean;
  /** The cycle currently mid-write, if any — its row actions are disabled. */
  busyCycleId: string | null;
  onOpenCycle: (cycle: PerformanceCycle) => void;
  onCloseCycle: (cycle: PerformanceCycle) => void;
  onEditDeadlines: (cycle: PerformanceCycle) => void;
  onCreate: () => void;
}

export function CycleList({
  cycles,
  loading,
  canManage,
  busyCycleId,
  onOpenCycle,
  onCloseCycle,
  onEditDeadlines,
  onCreate,
}: CycleListProps) {
  const t = useTranslations("pms");

  const stageColumns = STAGE_ORDER.map((kind) => ({
    key: `stage-${kind}`,
    title: t(`cycles.stage.${kind}`),
    dataIndex: "stages",
    render: (_value: CycleStage[], record: PerformanceCycle) => {
      const stage = record.stages.find((s) => s.kind === kind);
      if (!stage) {
        return <span className="text-xs text-muted-foreground">{t("cycles.stageNotSet")}</span>;
      }
      return (
        <div className="flex min-w-40 flex-col gap-0.5 text-xs">
          <span className="text-muted-foreground">
            {t("cycles.opensValue", { date: formatDate(stage.opensAt) })}
          </span>
          {/* The deadline carries its time on purpose — see the header note. */}
          <span className="font-medium text-foreground">
            {t("cycles.deadlineValue", { datetime: formatDateTime(stage.deadline) })}
          </span>
          <span className="text-muted-foreground">
            {t("cycles.graceValue", { days: stage.graceDays })}
          </span>
        </div>
      );
    },
  }));

  const columns = [
    {
      key: "year",
      title: t("cycles.year"),
      dataIndex: "year",
      render: (value: number) => <span className="font-medium text-foreground">{value}</span>,
    },
    {
      key: "status",
      title: t("status"),
      dataIndex: "status",
      render: (value: CycleStatus) => (
        <Badge variant={STATUS_TONE[value]}>{t(`cycles.statusValue.${value}`)}</Badge>
      ),
    },
    {
      key: "participants",
      title: t("cycles.participants"),
      dataIndex: "_count",
      render: (_value: PerformanceCycle["_count"], record: PerformanceCycle) =>
        record.status === "DRAFT" && record._count.participants === 0 ? (
          // §3.5 — nobody is enrolled until the cycle opens. Saying so beats a
          // bare 0, which reads as "nobody qualifies".
          <span className="text-xs text-muted-foreground">{t("cycles.enrolledAtOpen")}</span>
        ) : (
          <div className="flex flex-col gap-0.5">
            <span className="text-foreground">{record._count.participants}</span>
            {record.openedBy ? (
              <span className="text-xs text-muted-foreground">
                {t("cycles.openedBy", { name: record.openedBy.name })}
              </span>
            ) : null}
          </div>
        ),
    },
    ...stageColumns,
    {
      key: "actions",
      title: t("cycles.actions"),
      align: "right" as const,
      render: (_value: unknown, record: PerformanceCycle) => {
        if (!canManage) return null;
        const busy = busyCycleId === record.id;

        if (record.status === "CLOSED") {
          // Deliberately no control: DRAFT → OPEN → CLOSED is one-way, and a
          // reopen button would exist only to be refused with a 409.
          return <span className="text-xs text-muted-foreground">{t("cycles.closedNote")}</span>;
        }

        return (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {record.status === "DRAFT" ? (
              <ConfirmAction
                title={t("cycles.openConfirmTitle", { year: record.year })}
                description={t("cycles.openConfirmBody")}
                okText={t("cycles.openAction")}
                onConfirm={() => onOpenCycle(record)}
              >
                {/* Secondary, not primary: the screen's one primary action is
                    "New cycle" in the header (one primary per screen). */}
                <Button size="sm" variant="secondary" disabled={busy}>
                  {t("cycles.openAction")}
                </Button>
              </ConfirmAction>
            ) : null}

            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onEditDeadlines(record)}
            >
              {/* §5.5 — on an OPEN cycle this is an extension, a formal HR
                  intervention, not a correction. The label says which it is. */}
              {record.status === "OPEN" ? t("cycles.extendAction") : t("cycles.editAction")}
            </Button>

            {record.status === "OPEN" ? (
              <ConfirmAction
                title={t("cycles.closeConfirmTitle", { year: record.year })}
                description={t("cycles.closeConfirmBody")}
                okText={t("cycles.closeAction")}
                okType="danger"
                onConfirm={() => onCloseCycle(record)}
              >
                <Button size="sm" variant="ghost" disabled={busy}>
                  {t("cycles.closeAction")}
                </Button>
              </ConfirmAction>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <DataTable<PerformanceCycle>
      rowKey="id"
      columns={columns}
      dataSource={cycles}
      loading={loading}
      total={cycles.length}
      page={1}
      pageSize={50}
      scroll={{ x: 900 }}
      emptyText={
        <EmptyState
          description={canManage ? t("cycles.empty") : t("cycles.emptyViewer")}
          actionLabel={canManage ? t("cycles.newAction") : undefined}
          onAction={canManage ? onCreate : undefined}
          actionVariant="outline"
        />
      }
    />
  );
}
