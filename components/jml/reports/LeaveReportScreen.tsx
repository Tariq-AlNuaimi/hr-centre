"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
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
import { useNotify } from "@/hooks/use-notify";
import { apiClient } from "@/lib/api-client";
import { downloadFile } from "../download";
import { Field } from "@/components/shared/FormControls";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlLookups } from "../use-jml";

type Result = {
  title: string;
  columns: Array<{ key: string; title: string }>;
  cells: Array<Record<string, string | number | null>>;
  summary: Array<{ label: string; value: string | number | null }>;
  unavailable: Array<{ measure: string; needs: string }>;
  totalRecords: number;
  migratedExcluded: number;
  capReached: boolean;
  suppressedCells: number;
};

type Filters = {
  from: string;
  to: string;
  entityId: string;
  exitType: string;
  nationality: string;
  segment: string;
};
const EMPTY: Filters = {
  from: "",
  to: "",
  entityId: "",
  exitType: "",
  nationality: "",
  segment: "month",
};
const EXIT_TYPES = [
  "RESIGNATION",
  "TERMINATION",
  "CONTRACT_EXPIRY",
  "PROBATION_EXIT",
  "SUMMARY_DISMISSAL",
];
const SEGMENTS = ["month", "company", "directorate", "department", "role", "grade", "tenureBand"];

/** R1–R8 (Offboarding Module 16): filters on the last day of service, the cells, the summary, Excel. */
export function LeaveReportScreen({ slug }: { slug: string }) {
  const t = useTranslations("jml.reports.leave");
  const { can, isLoading } = useJmlAccess();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const params = new URLSearchParams(
    Object.entries(applied).filter(([k, v]) => v && (k !== "segment" || slug === "r2-attrition")),
  );
  const data = useQuery({
    queryKey: ["jml", "leave-report", slug, params.toString()],
    queryFn: () => apiClient.get<Result>(`/api/jml/leave-reports/${slug}?${params}`),
    enabled: can("jml.viewReports"),
  });
  if (isLoading) return <LoadingBlock />;
  if (!can("jml.viewReports")) return <NotPermitted title={t("title")} />;
  return (
    <div className="space-y-6">
      <PageHeader title={data.data?.title ?? t("title")} subtitle={t("subtitle")} />
      <FilterBar slug={slug} draft={draft} setDraft={setDraft} apply={() => setApplied(draft)} />
      {data.isLoading ? <LoadingBlock /> : null}
      {data.isError ? <LoadFailed /> : null}
      {data.data ? (
        <ResultView
          slug={slug}
          r={data.data}
          params={params}
          financial={can("jml.financialReports")}
        />
      ) : null}
    </div>
  );
}

function FilterBar({
  slug,
  draft,
  setDraft,
  apply,
}: {
  slug: string;
  draft: Filters;
  setDraft: (f: Filters) => void;
  apply: () => void;
}) {
  const t = useTranslations("jml.reports.leave");
  const tv = useTranslations("jml.leavers.vocab");
  const lookups = useJmlLookups();
  const set = (patch: Partial<Filters>) => setDraft({ ...draft, ...patch });
  return (
    <SectionCard title={t("filters")}>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field id="lr-from" label={t("from")}>
          <Input
            id="lr-from"
            type="date"
            value={draft.from}
            onChange={(e) => set({ from: e.target.value })}
          />
        </Field>
        <Field id="lr-to" label={t("to")}>
          <Input
            id="lr-to"
            type="date"
            value={draft.to}
            onChange={(e) => set({ to: e.target.value })}
          />
        </Field>
        <Field id="lr-company" label={t("company")}>
          <NativeSelect
            id="lr-company"
            className="w-full"
            value={draft.entityId}
            onChange={(e) => set({ entityId: e.target.value })}
          >
            <option value="">{t("all")}</option>
            {(lookups.data?.companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="lr-type" label={t("exitType")}>
          <NativeSelect
            id="lr-type"
            className="w-full"
            value={draft.exitType}
            onChange={(e) => set({ exitType: e.target.value })}
          >
            <option value="">{t("all")}</option>
            {EXIT_TYPES.map((x) => (
              <option key={x} value={x}>
                {tv(`exitType.${x}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="lr-nat" label={t("nationality")}>
          <NativeSelect
            id="lr-nat"
            className="w-full"
            value={draft.nationality}
            onChange={(e) => set({ nationality: e.target.value })}
          >
            <option value="">{t("all")}</option>
            <option value="OMANI">{tv("nationality.OMANI")}</option>
            <option value="EXPATRIATE">{tv("nationality.EXPATRIATE")}</option>
          </NativeSelect>
        </Field>
        {slug === "r2-attrition" ? (
          <Field id="lr-seg" label={t("segment")}>
            <NativeSelect
              id="lr-seg"
              className="w-full"
              value={draft.segment}
              onChange={(e) => set({ segment: e.target.value })}
            >
              {SEGMENTS.map((s) => (
                <option key={s} value={s}>
                  {t(`segments.${s}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={apply}>
          {t("apply")}
        </Button>
      </div>
    </SectionCard>
  );
}

function ResultView({
  slug,
  r,
  params,
  financial,
}: {
  slug: string;
  r: Result;
  params: URLSearchParams;
  financial: boolean;
}) {
  const t = useTranslations("jml.reports.leave");
  const { error } = useNotify();
  const [withMoney, setWithMoney] = useState(false);
  const exportIt = async (detail: boolean) => {
    const q = new URLSearchParams(params);
    if (detail) q.set("detail", "true");
    if (detail && withMoney) q.set("includeFinancial", "true");
    const problem = await downloadFile(
      `/api/jml/leave-reports/${slug}/export?${q}`,
      `${slug}.xlsx`,
    );
    if (problem) error(problem);
  };
  const cell = (v: string | number | null) =>
    v === "__below_reporting_threshold__" ? t("belowThreshold") : (v ?? "—");
  return (
    <>
      <SectionCard
        title={t("resultTitle", { count: r.totalRecords })}
        subtitle={
          [
            r.capReached ? t("capped") : null,
            r.suppressedCells ? t("suppressed", { count: r.suppressedCells }) : null,
            r.migratedExcluded ? t("migratedExcluded", { count: r.migratedExcluded }) : null,
          ]
            .filter(Boolean)
            .join(" ") || undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void exportIt(false)}>
              {t("export")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void exportIt(true)}>
              {t("exportCases")}
            </Button>
            {financial ? (
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={withMoney}
                  onChange={(e) => setWithMoney(e.target.checked)}
                />
                {t("withFinancial")}
              </label>
            ) : null}
          </div>
        }
      >
        {r.cells.length === 0 ? (
          <EmptyState description={t("empty")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {r.columns.map((c) => (
                    <TableHead key={c.key}>{c.title}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.cells.map((row, i) => (
                  <TableRow key={i}>
                    {r.columns.map((c) => (
                      <TableCell key={c.key}>{cell(row[c.key] ?? null)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
      {r.summary.length ? (
        <SectionCard title={t("summary")}>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {r.summary.map((s) => (
              <div key={s.label} className="flex justify-between gap-4 border-b border-border py-1">
                <dt className="text-muted-foreground">{s.label}</dt>
                <dd className="font-medium">{s.value ?? t("unavailableValue")}</dd>
              </div>
            ))}
          </dl>
        </SectionCard>
      ) : null}
      {r.unavailable.length ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {r.unavailable.map((u) => (
            <li key={u.measure}>{t("unavailable", { measure: u.measure, needs: u.needs })}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
