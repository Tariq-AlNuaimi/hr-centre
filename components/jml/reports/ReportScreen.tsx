"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { BarChart } from "@/components/shared/Chart";
import { Button } from "@/components/ui/button";
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
import { Field } from "../Field";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlLookups } from "../use-jml";

type Result = {
  slug: string;
  salaryCapable: boolean;
  includeSalary: boolean;
  columns: Array<{ title: string; key: string }>;
  rows: Array<Record<string, string | number | boolean | null>>;
  truncated: boolean;
  goLive: string | null;
};

type Filters = {
  from: string;
  to: string;
  joiningMonth: string;
  entityId: string;
  hrOwnerUserId: string;
};
const EMPTY: Filters = { from: "", to: "", joiningMonth: "", entityId: "", hrOwnerUserId: "" };

/** One report: the §13.3 filters, the table, Excel export, the trend chart. */
export function ReportScreen({ slug }: { slug: string }) {
  const t = useTranslations("jml.reports");
  const { can, isLoading } = useJmlAccess();
  const lookups = useJmlLookups(can("jml.viewReports"));
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [salary, setSalary] = useState(false);
  const params = new URLSearchParams(
    Object.fromEntries([
      ...Object.entries(applied).filter(([, v]) => v),
      ...(salary ? [["includeSalary", "true"]] : []),
    ]),
  );
  const data = useQuery({
    queryKey: ["jml", "report", slug, params.toString()],
    queryFn: () => apiClient.get<Result>(`/api/jml/reports/${slug}?${params}`),
    enabled: can("jml.viewReports"),
  });
  if (isLoading) return <LoadingBlock />;
  if (!can("jml.viewReports")) return <NotPermitted title={t("title")} />;
  const set = (k: keyof Filters, v: string) => setDraft({ ...draft, [k]: v });
  const r = data.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title={t(`report.${slug}.title`)}
        subtitle={t(`report.${slug}.note`)}
        actions={
          <a
            className={buttonVariants({ variant: "outline" })}
            href={`/api/jml/reports/${slug}/export?${params}`}
          >
            {t("export")}
          </a>
        }
      />
      <SectionCard title={t("filters")}>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field id="rf-from" label={t("from")}>
            <Input
              id="rf-from"
              type="date"
              value={draft.from}
              onChange={(e) => set("from", e.target.value)}
            />
          </Field>
          <Field id="rf-to" label={t("to")}>
            <Input
              id="rf-to"
              type="date"
              value={draft.to}
              onChange={(e) => set("to", e.target.value)}
            />
          </Field>
          <Field id="rf-month" label={t("joiningMonth")}>
            <Input
              id="rf-month"
              type="month"
              value={draft.joiningMonth}
              onChange={(e) => set("joiningMonth", e.target.value)}
            />
          </Field>
          <Field id="rf-company" label={t("company")}>
            <NativeSelect
              id="rf-company"
              className="w-full"
              value={draft.entityId}
              onChange={(e) => set("entityId", e.target.value)}
            >
              <option value="">{t("any")}</option>
              {(lookups.data?.companies ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="rf-owner" label={t("owner")}>
            <NativeSelect
              id="rf-owner"
              className="w-full"
              value={draft.hrOwnerUserId}
              onChange={(e) => set("hrOwnerUserId", e.target.value)}
            >
              <option value="">{t("any")}</option>
              {(lookups.data?.hrUsers ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.email}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="flex items-end gap-2">
            <Button size="sm" onClick={() => setApplied(draft)}>
              {t("apply")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDraft(EMPTY);
                setApplied(EMPTY);
              }}
            >
              {t("clear")}
            </Button>
          </div>
        </div>
        {r?.salaryCapable && can("people.viewSalary") ? (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={salary} onChange={(e) => setSalary(e.target.checked)} />
            {t("includeSalary")}
          </label>
        ) : null}
      </SectionCard>
      {data.isLoading ? (
        <LoadingBlock />
      ) : data.isError || !r ? (
        <div className="space-y-2">
          <LoadFailed />
          <Button size="sm" variant="outline" onClick={() => void data.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : (
        <SectionCard
          title={t("rows", { count: r.rows.length })}
          subtitle={r.truncated ? t("truncated") : undefined}
        >
          {slug === "onboarding-volume-trend" ? (
            r.rows.length < 2 ? (
              <p className="mb-4 text-sm text-muted-foreground">{t("trendTooShort")}</p>
            ) : (
              <div className="mb-4">
                <BarChart
                  data={r.rows as Array<Record<string, unknown>>}
                  xKey="month"
                  yKey="activated"
                  height={240}
                />
              </div>
            )
          ) : null}
          {r.rows.length === 0 ? (
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
                  {r.rows.map((row, i) => (
                    <TableRow key={i}>
                      {r.columns.map((c) => (
                        <TableCell key={c.key} className="text-sm">
                          {row[c.key] === null || row[c.key] === undefined
                            ? t("dash")
                            : String(row[c.key])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
