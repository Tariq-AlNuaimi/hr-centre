"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { buttonVariants } from "@/components/ui/button-variants";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/shared/DataTable";
import { FilterBar, FilterSelect } from "@/components/shared/FilterBar";
import { apiClient } from "@/lib/api-client";
import { CaseStatusBadge, DateText, DueLabel, Progress, RagBadge } from "../CaseBits";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess } from "../use-jml";

type CaseRow = {
  id: string;
  caseRef: string;
  caseType: "JOIN" | "MOVE" | "LEAVE";
  status: string;
  stage: string;
  completionPct: number;
  ragFlag: "GREEN" | "AMBER" | "RED";
  overdueTasks: number;
  nextDue: string | null;
  hrOwner: { name: string | null } | null;
  joinDetail: { plannedStartDate: string | null; actualStartDate: string | null } | null;
  moveDetail: { effectiveDate: string } | null;
  leaveDetail: { lastDayOfService: string | null } | null;
  employee: {
    name: string;
    employeeCode: string | null;
    entity: { name: string };
    department: { name: string } | null;
  };
};

type Page = { data: CaseRow[]; total: number; page: number; totalPages: number };

/** The date that matters for each type: start, effective date, last day of service. */
function keyDate(r: CaseRow): string | null {
  if (r.caseType === "JOIN")
    return r.joinDetail?.actualStartDate ?? r.joinDetail?.plannedStartDate ?? null;
  if (r.caseType === "MOVE") return r.moveDetail?.effectiveDate ?? null;
  return r.leaveDetail?.lastDayOfService ?? null;
}

const STATUS_SETS: Record<string, string> = {
  open: "ACTIVE,AT_RISK,PENDING_SETTLEMENT,COMPLETED",
  live: "ACTIVE,AT_RISK,PENDING_SETTLEMENT",
  completed: "COMPLETED,CLOSED",
  cancelled: "CANCELLED",
  archived: "ARCHIVED",
};

/**
 * Every case the actor may see — Onboarding `/onboarding`, for all three types.
 * UX P1 (perf-jml P1-5/P1-6): riskiest first (the server sorts RED, AMBER,
 * GREEN), with the type's key date, overdue tasks and next due date, on the
 * shared DataTable and FilterBar.
 */
export function CaseList({
  fixedType,
  header: customHeader,
}: { fixedType?: "JOIN" | "MOVE" | "LEAVE"; header?: ReactNode } = {}) {
  const t = useTranslations("jml.cases");
  const tv = useTranslations("jml.vocab");
  const { can, isLoading } = useJmlAccess();
  const [search, setSearch] = useState("");
  const [statusSet, setStatusSet] = useState("open");
  const [caseType, setCaseType] = useState<string>(fixedType ?? "");
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({
    page: String(page),
    pageSize: "25",
    status: STATUS_SETS[statusSet]!,
    ...(search.trim().length >= 2 ? { search: search.trim() } : {}),
    ...(caseType ? { caseType } : {}),
    ...(mine ? { mine: "true" } : {}),
  });
  const list = useQuery({
    queryKey: ["jml", "cases", params.toString()],
    queryFn: () => apiClient.get<Page>(`/api/jml/cases?${params}`),
    enabled: can("jml.view"),
  });
  const header = customHeader ?? (
    <PageHeader
      title={t("title")}
      subtitle={t("subtitle")}
      actions={
        <a
          className={buttonVariants({ variant: "outline" })}
          href={`/api/jml/cases/export?${params}`}
        >
          {t("export")}
        </a>
      }
    />
  );
  if (isLoading) return <LoadingBlock />;
  if (!can("jml.view")) return <NotPermitted title={t("title")} />;
  const rows = list.data?.data ?? [];
  return (
    <div className="space-y-6">
      {header}
      <SectionCard title={t("listTitle", { count: list.data?.total ?? 0 })}>
        <FilterBar className="mb-4">
          <div className="flex min-w-56 flex-col gap-1">
            <label htmlFor="case-search" className="text-xs text-muted-foreground">
              {t("search")}
            </label>
            <Input
              id="case-search"
              placeholder={t("search")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="h-9"
            />
          </div>
          <FilterSelect
            id="case-status"
            label={t("statusFilter")}
            allLabel={t("statusSet.open")}
            value={statusSet === "open" ? "" : statusSet}
            onChange={(v) => {
              setStatusSet(v || "open");
              setPage(1);
            }}
            options={Object.keys(STATUS_SETS)
              .filter((k) => k !== "open")
              .map((k) => ({ value: k, label: t(`statusSet.${k}`) }))}
          />
          {fixedType ? null : (
            <FilterSelect
              id="case-type"
              label={t("typeFilter")}
              allLabel={t("allTypes")}
              value={caseType}
              onChange={(v) => {
                setCaseType(v);
                setPage(1);
              }}
              options={(["JOIN", "MOVE", "LEAVE"] as const).map((c) => ({
                value: c,
                label: tv(`caseType.${c}`),
              }))}
            />
          )}
          <FilterSelect
            id="case-owner"
            label={t("ownership")}
            allLabel={t("everyone")}
            value={mine ? "mine" : ""}
            onChange={(v) => {
              setMine(v === "mine");
              setPage(1);
            }}
            options={[{ value: "mine", label: t("mine") }]}
          />
        </FilterBar>
        {list.isError ? (
          <LoadFailed />
        ) : (
          <DataTable<CaseRow>
            rowKey="id"
            loading={list.isLoading}
            dataSource={rows}
            total={list.data?.total ?? 0}
            page={page}
            pageSize={25}
            onPageChange={(p) => setPage(p)}
            emptyText={
              <EmptyState description={search || caseType || mine ? t("noMatches") : t("empty")} />
            }
            columns={[
              {
                title: t("col.case"),
                key: "case",
                render: (_: unknown, r: CaseRow) => (
                  <div>
                    <Link
                      href={`/jml/cases/${r.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {r.caseRef}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {tv(`caseType.${r.caseType}`)}
                    </div>
                  </div>
                ),
              },
              {
                title: t("col.employee"),
                key: "employee",
                render: (_: unknown, r: CaseRow) => (
                  <div>
                    {r.employee.name}
                    <div className="text-xs text-muted-foreground">
                      {r.employee.department?.name ?? t("noDepartment")} · {r.employee.entity.name}
                    </div>
                  </div>
                ),
              },
              {
                title: t("col.owner"),
                key: "owner",
                render: (_: unknown, r: CaseRow) => r.hrOwner?.name ?? t("unassigned"),
              },
              {
                title: t("col.keyDate"),
                key: "keyDate",
                render: (_: unknown, r: CaseRow) => <DateText value={keyDate(r)} />,
              },
              {
                title: t("col.risk"),
                key: "risk",
                render: (_: unknown, r: CaseRow) => (
                  <div className="flex flex-col items-start gap-1">
                    <RagBadge flag={r.ragFlag} status={r.status} />
                    {r.overdueTasks > 0 ? (
                      <span className="text-xs text-destructive-emphasis">
                        {t("overdueTasks", { count: r.overdueTasks })}
                      </span>
                    ) : null}
                  </div>
                ),
              },
              {
                title: t("col.nextDue"),
                key: "nextDue",
                render: (_: unknown, r: CaseRow) => <DueLabel value={r.nextDue} />,
              },
              {
                title: t("col.stage"),
                key: "stage",
                render: (_: unknown, r: CaseRow) => (
                  <div className="flex flex-col gap-1">
                    <span className="text-sm">{tv(`stage.${r.stage}`)}</span>
                    <Progress value={r.completionPct} />
                  </div>
                ),
              },
              {
                title: t("col.status"),
                key: "status",
                render: (_: unknown, r: CaseRow) => <CaseStatusBadge status={r.status} />,
              },
            ]}
          />
        )}
      </SectionCard>
    </div>
  );
}
