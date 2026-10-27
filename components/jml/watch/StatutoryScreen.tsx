"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { FilterChips } from "@/components/shared/FilterBar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api-client";
import { DateText } from "../CaseBits";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess } from "../use-jml";

type Row = {
  taskId: string;
  caseId: string;
  caseRef: string;
  caseType: string;
  employee: string;
  task: string;
  category: string | null;
  deadline: string | null;
  workingDays: number | null;
  hrOwner: string | null;
  risk: "overdue" | "no_deadline" | "due_soon" | "scheduled";
  status: string;
};

const RISK = {
  overdue: "danger",
  no_deadline: "warning",
  due_soon: "warning",
  scheduled: "default",
} as const;

/** Statutory & visa watch (FR-DASH-008, BR-025) — every case type, in working days. */
export function StatutoryScreen() {
  const t = useTranslations("jml.statutory");
  const tv = useTranslations("jml.vocab");
  const { can, isLoading } = useJmlAccess();
  // FR-DASH-004: Senior defaults to everyone's, Junior to their own — a default, not a permission.
  const [mineChoice, setMine] = useState<boolean | null>(null);
  const mine = mineChoice ?? !can("jml.supervise");
  const [all, setAll] = useState(false);
  const data = useQuery({
    queryKey: ["jml", "statutory", mine, all],
    queryFn: () => apiClient.get<{ rows: Row[] }>(`/api/jml/statutory?mine=${mine}&all=${all}`),
    enabled: can("jml.view"),
  });
  if (isLoading) return <LoadingBlock />;
  if (!can("jml.view")) return <NotPermitted title={t("title")} />;
  const rows = data.data?.rows ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <SectionCard title={t("listTitle", { count: rows.length })}>
        <div className="mb-4 flex flex-wrap gap-3">
          <FilterChips
            label={t("ownership")}
            value={mine ? "mine" : "all"}
            onChange={(v) => setMine(v === "mine")}
            chips={[
              { value: "mine", label: t("mine") },
              { value: "all", label: t("everyone") },
            ]}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            {t("includeScheduled")}
          </label>
        </div>
        {data.isLoading ? (
          <LoadingBlock />
        ) : data.isError ? (
          <LoadFailed />
        ) : rows.length === 0 ? (
          <EmptyState description={all ? t("emptyAll") : t("emptyAtRisk")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("col.employee")}</TableHead>
                <TableHead>{t("col.task")}</TableHead>
                <TableHead>{t("col.category")}</TableHead>
                <TableHead>{t("col.deadline")}</TableHead>
                <TableHead>{t("col.workingDays")}</TableHead>
                <TableHead>{t("col.owner")}</TableHead>
                <TableHead>{t("col.risk")}</TableHead>
                <TableHead>{t("col.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.taskId}>
                  <TableCell>
                    <Link
                      href={`/jml/cases/${r.caseId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {r.employee}
                    </Link>
                    <div className="text-xs text-muted-foreground">{r.caseRef}</div>
                  </TableCell>
                  <TableCell className="text-sm">{r.task}</TableCell>
                  <TableCell className="text-sm">{r.category ?? t("dash")}</TableCell>
                  <TableCell className="text-sm">
                    <DateText value={r.deadline} />
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {r.workingDays ?? t("dash")}
                  </TableCell>
                  <TableCell className="text-sm">{r.hrOwner ?? t("dash")}</TableCell>
                  <TableCell>
                    <Badge variant={RISK[r.risk]}>{t(`risk.${r.risk}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{tv(`taskStatus.${r.status}`)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
