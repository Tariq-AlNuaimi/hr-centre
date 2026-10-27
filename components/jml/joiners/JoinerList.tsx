"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { buttonVariants } from "@/components/ui/button-variants";
import { Input } from "@/components/ui/input";
import { FilterBar, FilterChips, FilterSelect } from "@/components/shared/FilterBar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api-client";
import { CaseStatusBadge, DateText, Pager } from "../CaseBits";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlLookups } from "../use-jml";
import { EMPLOYMENT_TYPES } from "./JoinerFields";

type Row = {
  caseId: string;
  caseRef: string | null;
  status: string;
  fullName: string;
  employeeCode: string | null;
  jobTitle: string | null;
  company: string;
  department: string | null;
  employmentType: string | null;
  plannedStartDate: string | null;
};

type Filters = {
  search: string;
  status: string;
  entityId: string;
  departmentId: string;
  employmentType: string;
};
const NO_FILTERS: Filters = {
  search: "",
  status: "all",
  entityId: "",
  departmentId: "",
  employmentType: "",
};

function paramsOf(f: Filters, page: number): URLSearchParams {
  const params = new URLSearchParams({ page: String(page), pageSize: "25", status: f.status });
  if (f.search.trim().length >= 2) params.set("search", f.search.trim());
  for (const key of ["entityId", "departmentId", "employmentType"] as const) {
    if (f[key]) params.set(key, f[key]);
  }
  return params;
}

const isFiltered = (f: Filters) =>
  Boolean(f.search || f.entityId || f.departmentId || f.employmentType || f.status !== "all");

/** Joiners — Onboarding `/new-hires` (drafts and activated; never salary). */
export function JoinerList() {
  const t = useTranslations("jml.joiners");
  const tc = useTranslations("people.record.contract");
  const { can, isLoading } = useJmlAccess();
  const lookups = useJmlLookups(can("jml.view"));
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const upd = (key: keyof Filters, value: string) => {
    setF({ ...f, [key]: value });
    setPage(1);
  };
  const params = paramsOf(f, page);
  const list = useQuery({
    queryKey: ["jml", "joiners", params.toString()],
    queryFn: () =>
      apiClient.get<{ data: Row[]; total: number; totalPages: number }>(
        `/api/jml/joiners?${params}`,
      ),
    enabled: can("jml.view"),
  });
  if (isLoading) return <LoadingBlock />;
  if (!can("jml.view")) return <NotPermitted title={t("title")} />;
  const rows = list.data?.data ?? [];
  const filtered = isFiltered(f);
  const departments = (lookups.data?.departments ?? []).filter(
    (d) => !f.entityId || d.entityId === f.entityId,
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          can("jml.manageJoiners") ? (
            <Link href="/jml/joiners/new" className={buttonVariants({ variant: "default" })}>
              {t("add")}
            </Link>
          ) : null
        }
      />
      <SectionCard title={t("listTitle", { count: list.data?.total ?? 0 })}>
        <div className="mb-4 space-y-3">
          <FilterChips
            label={t("statusFilter")}
            value={f.status}
            onChange={(v) => upd("status", v)}
            chips={["all", "draft", "active"].map((s) => ({ value: s, label: t(`status.${s}`) }))}
          />
          <FilterBar>
            <Input
              aria-label={t("search")}
              placeholder={t("search")}
              value={f.search}
              className="max-w-xs"
              onChange={(e) => {
                upd("search", e.target.value);
                setPage(1);
              }}
            />
            <FilterSelect
              id="joiner-company"
              label={t("company")}
              allLabel={t("allCompanies")}
              value={f.entityId}
              onChange={(v) => upd("entityId", v)}
              options={(lookups.data?.companies ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
            <FilterSelect
              id="joiner-department"
              label={t("department")}
              allLabel={t("allDepartments")}
              value={f.departmentId}
              onChange={(v) => upd("departmentId", v)}
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
            />
            <FilterSelect
              id="joiner-type"
              label={t("employmentType")}
              allLabel={t("allTypes")}
              value={f.employmentType}
              onChange={(v) => upd("employmentType", v)}
              options={EMPLOYMENT_TYPES.map((e) => ({ value: e, label: tc(e) }))}
            />
          </FilterBar>
        </div>
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.isError ? (
          <LoadFailed />
        ) : rows.length === 0 ? (
          <EmptyState description={filtered ? t("noMatches") : t("empty")} />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("col.name")}</TableHead>
                  <TableHead>{t("col.code")}</TableHead>
                  <TableHead>{t("col.jobTitle")}</TableHead>
                  <TableHead>{t("col.placement")}</TableHead>
                  <TableHead>{t("col.type")}</TableHead>
                  <TableHead>{t("col.start")}</TableHead>
                  <TableHead>{t("col.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.caseId}>
                    <TableCell>
                      <Link
                        href={`/jml/joiners/${r.caseId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.fullName}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {r.caseRef ?? t("draftLabel")}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{r.employeeCode ?? t("noCode")}</TableCell>
                    <TableCell className="text-sm">{r.jobTitle ?? t("dash")}</TableCell>
                    <TableCell className="text-sm">
                      {r.department ?? t("dash")}
                      <div className="text-xs text-muted-foreground">{r.company}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.employmentType ? tc(r.employmentType) : t("dash")}
                    </TableCell>
                    <TableCell className="text-sm">
                      <DateText value={r.plannedStartDate} />
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
