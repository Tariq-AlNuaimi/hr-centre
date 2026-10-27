"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Download, Plus, Rows3 } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { DataTable, type SortChange } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { NativeSelect } from "@/components/org/NativeSelect";
import { formatDate } from "@/lib/format";
import { formatBand } from "@/lib/hiring/money";
import { qs, useHiringMe, useHiringQuery } from "../ui/api";
import { StatusBadge } from "../ui/badges";
import { QueryState } from "../ui/states";

export type RequisitionRow = {
  id: string;
  title: string;
  status: string;
  jdStatus: string;
  grade: string | null;
  openings: number;
  salaryCurrency: string;
  salaryBandMin: number | null;
  salaryBandMax: number | null;
  bandHidden: boolean;
  targetCloseDate: string | null;
  createdAt: string;
  entity: { name: string } | null;
  departmentName: string | null;
  hiringManager: { name: string } | null;
  candidateCount: number;
  /** The next unsigned approval step and how long it has waited (UX P1-12). */
  pendingStep: { role: string; days: number } | null;
  pastTargetClose: boolean;
};

const STATUSES = ["DRAFT", "PENDING_APPROVAL", "OPEN", "ON_HOLD", "FILLED", "REOPENED", "ARCHIVED"];

const daysOpen = (createdAt: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000));

/** Days a requisition has been open — warns at 14, alarms at 25 (Interview Hub list). */
function daysOpenTone(days: number): string {
  if (days >= 25) return "font-semibold text-destructive-emphasis";
  if (days >= 14) return "font-semibold text-status-warn-fg";
  return "text-muted-foreground";
}

/** Status, or "Pending: <role> (Nd)" while an approval step waits. */
function StatusCell({ row }: { row: RequisitionRow }) {
  const t = useTranslations("hiring.requisitions");
  if (row.status === "PENDING_APPROVAL" && row.pendingStep) {
    return (
      <span className="text-sm font-medium text-status-warn-fg">
        {t("pendingOn", { role: row.pendingStep.role, days: row.pendingStep.days })}
      </span>
    );
  }
  return <StatusBadge kind="requisition" value={row.status} />;
}

export function RequisitionList() {
  const t = useTranslations("hiring.requisitions");
  const ts = useTranslations("hiring.status.requisition");
  const router = useRouter();
  const locale = useLocale();
  const { has } = useHiringMe();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<SortChange>({});
  const params = {
    page,
    pageSize,
    search,
    status,
    sort: sort.field,
    order: sort.order === "ascend" ? "asc" : sort.order === "descend" ? "desc" : undefined,
  };
  const { data, isLoading, error, refetch } = useHiringQuery<{
    data: RequisitionRow[];
    total: number;
  }>(`/api/hiring/requisitions${qs(params)}`);
  const base = `/${locale}/hiring/requisitions`;
  const canManage = has("hiring.manage");

  const columns = [
    {
      title: t("colTitle"),
      dataIndex: "title",
      key: "title",
      sorter: true,
      render: (v: string, r: RequisitionRow) => (
        <div className="flex min-w-0 flex-col">
          <Link href={`${base}/${r.id}`} className="font-medium text-foreground hover:underline">
            {v}
          </Link>
          <span className="truncate text-xs text-muted-foreground">
            {[r.departmentName, r.entity?.name].filter(Boolean).join(" · ")}
          </span>
        </div>
      ),
    },
    {
      title: t("colManager"),
      key: "hm",
      render: (_: unknown, r: RequisitionRow) => r.hiringManager?.name ?? "—",
    },
    {
      title: t("colGrade"),
      key: "grade",
      render: (_: unknown, r: RequisitionRow) => (
        <div className="flex flex-col text-sm">
          <span>{r.grade ?? "—"}</span>
          <span className="text-xs text-muted-foreground">
            {r.bandHidden
              ? t("bandHidden")
              : formatBand(r.salaryBandMin, r.salaryBandMax, r.salaryCurrency)}
          </span>
        </div>
      ),
    },
    {
      title: t("colStatus"),
      dataIndex: "status",
      key: "status",
      sorter: true,
      render: (_: string, r: RequisitionRow) => <StatusCell row={r} />,
    },
    { title: t("colCandidates"), dataIndex: "candidateCount", key: "candidates" },
    {
      title: t("colOpened"),
      dataIndex: "createdAt",
      key: "createdAt",
      sorter: true,
      render: (v: string) => <span className="text-sm text-muted-foreground">{formatDate(v)}</span>,
    },
    {
      title: t("colDaysOpen"),
      key: "daysOpen",
      align: "right" as const,
      render: (_: unknown, r: RequisitionRow) => {
        const d = daysOpen(r.createdAt);
        return (
          <span className={`font-mono text-sm ${daysOpenTone(d)}`}>{t("days", { days: d })}</span>
        );
      },
    },
    {
      title: t("colClose"),
      dataIndex: "targetCloseDate",
      key: "targetCloseDate",
      sorter: true,
      render: (v: string | null, r: RequisitionRow) =>
        v ? (
          <span className="inline-flex items-center gap-1.5">
            {formatDate(v)}
            {r.pastTargetClose ? <Badge variant="danger">{t("overdue")}</Badge> : null}
          </span>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            <Button variant="outline" onClick={() => router.push(`/${locale}/hiring/planning`)}>
              <Rows3 className="h-4 w-4" />
              {t("planning")}
            </Button>
            {canManage ? (
              <a
                className={buttonVariants({ variant: "outline" })}
                href={`/api/hiring/requisitions/export${qs({ search, status })}`}
              >
                <Download className="h-4 w-4" />
                {t("export")}
              </a>
            ) : null}
            {canManage ? (
              <Button variant="outline" onClick={() => router.push(`${base}/new`)}>
                {t("fromTemplate")}
              </Button>
            ) : null}
            {canManage ? (
              <Button onClick={() => router.push(`${base}/request`)}>
                <Plus className="h-4 w-4" />
                {t("newRequest")}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="req-status" className="text-sm text-muted-foreground">
          {t("filterStatus")}
        </label>
        <NativeSelect
          id="req-status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t("allStatuses")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {ts(s)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <QueryState isLoading={false} error={error} onRetry={() => void refetch()}>
        <DataTable<RequisitionRow>
          rowKey="id"
          columns={columns}
          dataSource={data?.data ?? []}
          loading={isLoading}
          total={data?.total ?? 0}
          page={page}
          pageSize={pageSize}
          onPageChange={(p, ps) => {
            setPage(p);
            setPageSize(ps);
          }}
          onSortChange={(s) => {
            setSort(s);
            setPage(1);
          }}
          searchable
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
          emptyText={
            <EmptyState
              description={t("empty")}
              actionLabel={canManage ? t("newRequest") : undefined}
              actionVariant="outline"
              onAction={canManage ? () => router.push(`${base}/request`) : undefined}
            />
          }
        />
      </QueryState>
    </div>
  );
}
