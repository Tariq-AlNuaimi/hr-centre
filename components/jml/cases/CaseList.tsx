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
import { NativeSelect } from "@/components/org/NativeSelect";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api-client";
import { CaseStatusBadge, DateText, Pager, Progress } from "../CaseBits";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess } from "../use-jml";

type CaseRow = {
  id: string;
  caseRef: string;
  caseType: "JOIN" | "MOVE" | "LEAVE";
  status: string;
  stage: string;
  completionPct: number;
  hrOwner: { name: string | null } | null;
  joinDetail: { plannedStartDate: string | null; actualStartDate: string | null } | null;
  employee: {
    name: string;
    employeeCode: string | null;
    entity: { name: string };
    department: { name: string } | null;
  };
};

type Page = { data: CaseRow[]; total: number; page: number; totalPages: number };

const STATUS_SETS: Record<string, string> = {
  open: "ACTIVE,AT_RISK,PENDING_SETTLEMENT,COMPLETED",
  live: "ACTIVE,AT_RISK,PENDING_SETTLEMENT",
  completed: "COMPLETED,CLOSED",
  cancelled: "CANCELLED",
  archived: "ARCHIVED",
};

/** Every case the actor may see — Onboarding `/onboarding`, for all three types. */
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
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Input
            aria-label={t("search")}
            placeholder={t("search")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="max-w-xs"
          />
          <NativeSelect
            aria-label={t("statusFilter")}
            value={statusSet}
            onChange={(e) => setStatusSet(e.target.value)}
          >
            {Object.keys(STATUS_SETS).map((k) => (
              <option key={k} value={k}>
                {t(`statusSet.${k}`)}
              </option>
            ))}
          </NativeSelect>
          {fixedType ? null : (
            <NativeSelect
              aria-label={t("typeFilter")}
              value={caseType}
              onChange={(e) => setCaseType(e.target.value)}
            >
              <option value="">{t("allTypes")}</option>
              {(["JOIN", "MOVE", "LEAVE"] as const).map((c) => (
                <option key={c} value={c}>
                  {tv(`caseType.${c}`)}
                </option>
              ))}
            </NativeSelect>
          )}
          <NativeSelect
            aria-label={t("ownership")}
            value={mine ? "mine" : "all"}
            onChange={(e) => setMine(e.target.value === "mine")}
          >
            <option value="all">{t("everyone")}</option>
            <option value="mine">{t("mine")}</option>
          </NativeSelect>
        </div>
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.isError ? (
          <LoadFailed />
        ) : rows.length === 0 ? (
          <EmptyState description={search || caseType || mine ? t("noMatches") : t("empty")} />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("col.case")}</TableHead>
                  <TableHead>{t("col.employee")}</TableHead>
                  <TableHead>{t("col.placement")}</TableHead>
                  <TableHead>{t("col.owner")}</TableHead>
                  <TableHead>{t("col.start")}</TableHead>
                  <TableHead>{t("col.stage")}</TableHead>
                  <TableHead>{t("col.progress")}</TableHead>
                  <TableHead>{t("col.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        href={`/jml/cases/${r.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.caseRef}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {tv(`caseType.${r.caseType}`)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {r.employee.name}
                      <div className="text-xs text-muted-foreground">
                        {r.employee.employeeCode ?? t("noCode")}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.employee.department?.name ?? t("noDepartment")}
                      <div className="text-xs text-muted-foreground">{r.employee.entity.name}</div>
                    </TableCell>
                    <TableCell className="text-sm">{r.hrOwner?.name ?? t("unassigned")}</TableCell>
                    <TableCell className="text-sm">
                      <DateText
                        value={r.joinDetail?.actualStartDate ?? r.joinDetail?.plannedStartDate}
                      />
                    </TableCell>
                    <TableCell className="text-sm">{tv(`stage.${r.stage}`)}</TableCell>
                    <TableCell>
                      <Progress value={r.completionPct} />
                    </TableCell>
                    <TableCell>
                      <CaseStatusBadge status={r.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager page={page} totalPages={list.data?.totalPages ?? 1} onPage={setPage} />
          </>
        )}
      </SectionCard>
    </div>
  );
}
