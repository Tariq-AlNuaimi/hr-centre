"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import type { ParticipantRow } from "@/components/pms/ParticipantList";

/**
 * The mid-year roster — §6, and deliberately NOT `ParticipantList`.
 *
 * Reusing the goal-setting roster here was the obvious move and the wrong one.
 * Every state sentence that component renders answers a GOAL-SETTING question:
 * "Ready to sign" is §5.3 measured against sign-off, and `editBlockedReason`
 * is the answer to "may this manager draft KPIs", computed against the
 * goal-setting stage. On a mid-year screen all of it is a confident answer to a
 * question nobody asked — a manager reading "This cycle has no goal-setting
 * stage configured yet" while trying to raise a change request learns nothing
 * true about whether they can.
 *
 * What mid-year actually needs per row is smaller: is there an HR-approved
 * baseline to change at all (§5.1), and what does the set weigh right now
 * (§5.3, the number a rebalance has to land on). Both are already in the roster
 * payload, so this is presentation only — no second endpoint, no second query.
 */

export function MidYearRoster({
  rows,
  loading,
  total,
  page,
  pageSize,
  filtered,
  onSearch,
  onPageChange,
  hrefFor,
}: {
  rows: ParticipantRow[];
  loading?: boolean;
  total: number;
  page: number;
  pageSize: number;
  filtered: boolean;
  onSearch: (value: string) => void;
  onPageChange: (page: number, pageSize: number) => void;
  hrefFor: (row: ParticipantRow) => string;
}) {
  const t = useTranslations("pms.midYear");

  return (
    <DataTable<ParticipantRow>
      rowKey="participantId"
      dataSource={rows}
      loading={loading}
      total={total}
      page={page}
      pageSize={pageSize}
      onPageChange={onPageChange}
      searchable
      onSearch={onSearch}
      scroll={{ x: 800 }}
      emptyText={<EmptyState description={filtered ? t("noMatches") : t("rosterEmpty")} />}
      columns={[
        {
          key: "employee",
          title: t("column.employee"),
          render: (_value: unknown, row: ParticipantRow) => (
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">
                {row.employee.name}
              </div>
              <div className="truncate text-xs text-muted-foreground">{row.employee.email}</div>
              {row.employee.department ? (
                <div className="truncate text-xs text-muted-foreground">
                  {row.employee.department.name}
                </div>
              ) : null}
            </div>
          ),
        },
        {
          key: "baseline",
          title: t("column.baseline"),
          // §5.1 — §6 amends an HR-APPROVED baseline. Before that approval there
          // is nothing for a change request to change, and this column is the
          // only place a manager can see which of their reports are ready.
          render: (_value: unknown, row: ParticipantRow) =>
            row.goalSettingExempt ? (
              <Badge variant="outline">{t("exempt")}</Badge>
            ) : row.goalsApprovedAt === null ? (
              <Badge variant="outline">{t("noBaseline")}</Badge>
            ) : (
              <Badge variant="success">{t("baselineApproved")}</Badge>
            ),
        },
        {
          key: "weightage",
          title: t("column.weightage"),
          // The decimal STRING the server computed — never re-summed here (§5.3).
          render: (_value: unknown, row: ParticipantRow) => (
            <div className="space-y-0.5">
              <div className="text-sm text-foreground">{row.weightageTotal}%</div>
              <div className="text-xs text-muted-foreground">
                {t("kpiCount", { count: row.kpiCount })}
              </div>
            </div>
          ),
        },
        {
          key: "actions",
          title: t("column.actions"),
          render: (_value: unknown, row: ParticipantRow) => (
            <Link
              href={hrefFor(row)}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {t("openRow")}
            </Link>
          ),
        },
      ]}
    />
  );
}
