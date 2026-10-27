"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
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
  /** §6.2 / §7.1 / §8.7 — the three answers the spec leaves to Rihal. */
  onEditPolicy: (cycle: PerformanceCycle) => void;
  /** §3.5 — pull in employees who arrived after the cycle opened. */
  onEnrolMissing: (cycle: PerformanceCycle) => void;
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
  onEditPolicy,
  onEnrolMissing,
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
      // UX P1 (perf-jml P1-8): the year opens the cycle's console.
      render: (value: number, record: PerformanceCycle) => (
        <Link
          href={`/admin/cycles/${record.id}`}
          className="font-medium text-primary-emphasis underline-offset-4 hover:underline"
        >
          {value}
        </Link>
      ),
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

            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onEditPolicy(record)}
            >
              {/* Readable on an OPEN cycle, editable only on a DRAFT — the
                  label says which, so nobody opens it expecting to change
                  something the route will refuse. */}
              {record.status === "DRAFT" ? t("cycles.policyAction") : t("cycles.policyViewAction")}
            </Button>

            {/* §3.5 — OPEN only, because a DRAFT cycle enrols everyone the
                moment it opens and a CLOSED year must stop moving. This is the
                manual counterpart to the import's own enrolment: it exists for
                the import that applied while enrolment failed, and for people
                who arrived by some other route. Idempotent, so pressing it
                twice is not a thing anyone has to worry about. */}
            {record.status === "OPEN" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onEnrolMissing(record)}
              >
                {t("cycles.enrolMissingAction")}
              </Button>
            ) : null}

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
