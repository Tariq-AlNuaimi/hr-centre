"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type { GoalStage } from "@/components/pms/StageBanner";

/**
 * The goal-setting roster — spec §5.1 (who is where in the flow), §4.2 (act on a
 * DIRECT report, view the whole chain), §5.3 (the 100% rule) and §8.3.
 *
 * The row's own `editBlockedReason` is what decides whether this viewer may act
 * on it — the same sentence `POST /api/kpis` would answer with — so the table
 * never offers a control the write route would refuse. Where a row is view-only
 * the reason is SHOWN rather than swallowed: §4.2's "view-only below direct
 * reports" is a rule the manager should be able to read off the screen, not a
 * mystery about why one row has a different button.
 */

export interface ParticipantRow {
  participantId: string;
  employee: {
    id: string;
    name: string;
    email: string;
    roleTrack: string;
    status: string;
    managerId: string | null;
    department: { id: string; name: string } | null;
    entity: { id: string; code: string } | null;
  };
  kpiCount: number;
  /** Decimal STRING — displayed, never re-summed as a float (§5.3). */
  weightageTotal: string;
  weightageComplete: boolean;
  weightageMessage: string | null;
  signOff: {
    employeeSignedAt: string | null;
    managerSignedAt: string | null;
    bothSigned: boolean;
  };
  goalsApprovedAt: string | null;
  /** §8.3 — C-Level skip goal-setting entirely. */
  goalSettingExempt: boolean;
  /** Verbatim server sentence, or null when this actor may act on the row. */
  editBlockedReason: string | null;
}

/**
 * `GET /api/cycles/[id]/participants` — the paginated envelope plus the two
 * page-level facts every caller needs: which cycle this is, and where its
 * goal-setting stage sits right now (§5.4). `stage` is null when the cycle has
 * no goal-setting stage configured yet, which is a legitimate DRAFT state.
 */
export interface RosterResponse {
  data: ParticipantRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  cycle: { id: string; year: number; status: string };
  stage: (GoalStage & { kind: string }) | null;
}

interface ParticipantListProps {
  rows: ParticipantRow[];
  loading?: boolean;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number, pageSize: number) => void;
  onSearch: (value: string) => void;
  /** True when a search/filter is active — changes which empty copy is honest. */
  filtered: boolean;
  /** Where each row links to: the drafting screen for that participant. */
  hrefFor: (row: ParticipantRow) => string;
}

export function ParticipantList({
  rows,
  loading,
  total,
  page,
  pageSize,
  onPageChange,
  onSearch,
  filtered,
  hrefFor,
}: ParticipantListProps) {
  const t = useTranslations("pms.goalSetting");
  const tKpi = useTranslations("pms.kpi");

  function stateBadge(row: ParticipantRow): { label: string; tone: BadgeProps["variant"] } {
    if (row.goalSettingExempt) return { label: t("exempt"), tone: "outline" };
    if (row.goalsApprovedAt) return { label: t("approved"), tone: "brand" };
    if (row.editBlockedReason === null) return { label: t("directReport"), tone: "success" };
    return { label: t("viewOnly"), tone: "outline" };
  }

  const columns = [
    {
      key: "employee",
      title: t("column.employee"),
      dataIndex: "employee",
      render: (_value: ParticipantRow["employee"], row: ParticipantRow) => (
        <div className="flex min-w-48 flex-col gap-0.5">
          <span className="font-medium text-foreground">{row.employee.name}</span>
          <span className="text-xs text-muted-foreground">{row.employee.email}</span>
          {row.employee.department ? (
            <span className="text-xs text-muted-foreground">{row.employee.department.name}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "state",
      title: t("column.state"),
      render: (_value: unknown, row: ParticipantRow) => {
        const { label, tone } = stateBadge(row);
        return (
          <div className="flex min-w-48 flex-col gap-1">
            <Badge variant={tone}>{label}</Badge>
            {row.editBlockedReason && !row.goalSettingExempt ? (
              <span className="max-w-xs text-xs text-muted-foreground">
                {row.editBlockedReason}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "kpis",
      title: t("column.kpis"),
      dataIndex: "kpiCount",
      render: (value: number) =>
        value === 0 ? (
          <span className="text-xs text-muted-foreground">{t("noKpis")}</span>
        ) : (
          <span className="text-foreground">{t("kpiCount", { count: value })}</span>
        ),
    },
    {
      key: "weightage",
      title: t("column.weightage"),
      render: (_value: unknown, row: ParticipantRow) =>
        row.goalSettingExempt ? (
          <span className="text-xs text-muted-foreground">{t("noKpis")}</span>
        ) : (
          <div className="flex min-w-32 flex-col gap-1">
            {/* The BOOLEAN decides; the string is only ever displayed (§5.3). */}
            <Badge variant={row.weightageComplete ? "success" : "warning"}>
              {tKpi("weightageValue", { total: row.weightageTotal })}
            </Badge>
            {row.weightageComplete ? (
              <span className="text-xs text-muted-foreground">{t("ready")}</span>
            ) : null}
          </div>
        ),
    },
    {
      key: "signOff",
      title: t("column.signOff"),
      render: (_value: unknown, row: ParticipantRow) => (
        <div className="flex min-w-40 flex-col gap-1">
          {/* §5.3 — the unsigned state IS the signal, so both parties are always
              listed and an absent signature is stated, never omitted. */}
          <Badge variant={row.signOff.employeeSignedAt ? "success" : "outline"}>
            {tKpi("party.EMPLOYEE")}
          </Badge>
          <Badge variant={row.signOff.managerSignedAt ? "success" : "outline"}>
            {tKpi("party.MANAGER")}
          </Badge>
        </div>
      ),
    },
    {
      key: "actions",
      title: t("column.actions"),
      align: "right" as const,
      render: (_value: unknown, row: ParticipantRow) => (
        <Link href={hrefFor(row)} className={buttonVariants({ variant: "outline", size: "sm" })}>
          {row.editBlockedReason === null && !row.goalSettingExempt
            ? t("openAction")
            : t("viewAction")}
        </Link>
      ),
    },
  ];

  return (
    <DataTable<ParticipantRow>
      rowKey="participantId"
      columns={columns}
      dataSource={rows}
      loading={loading}
      total={total}
      page={page}
      pageSize={pageSize}
      onPageChange={onPageChange}
      searchable
      onSearch={onSearch}
      scroll={{ x: 1000 }}
      emptyText={<EmptyState description={filtered ? t("emptySearch") : t("empty")} />}
    />
  );
}
