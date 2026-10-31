"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";
import { ResolvePreview } from "@/components/jml/settings/ResolvePreview";
import { useJmlLookups } from "@/components/jml/use-jml";
import { HrCoverageDialog, type CoverageOptions, type CoverageRow } from "./HrCoverageDialog";

/**
 * Admin › Settings › HR coverage (ADR-102) — "who is my HR", in one place: for
 * each company, directorate, department or team, the HR pair its tickets go to
 * and the HR people who own and supervise its joiner, mover and leaver cases.
 */

type View = {
  can: { tickets: boolean; jml: boolean };
  rows: CoverageRow[];
  options: CoverageOptions;
};

export function HrCoverageSettings() {
  const t = useTranslations("hrCoverage");
  const { success, error: notifyError } = useNotify();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<CoverageRow | "new" | null>(null);
  const q = useQuery({
    queryKey: ["hr-coverage"],
    queryFn: () => apiClient.get<View>("/api/hr-coverage"),
    retry: false,
  });
  // The "who would own a case here?" preview (JML's resolution of these rows).
  const lookups = useJmlLookups(Boolean(q.data?.can.jml));
  const header = <PageHeader title={t("title")} subtitle={t("subtitle")} />;

  if (q.isLoading)
    return (
      <>
        {header}
        <TableSkeleton rows={6} />
      </>
    );
  if (q.isError || !q.data)
    return (
      <>
        {header}
        <p role="alert" className="text-sm text-destructive-emphasis">
          {q.error instanceof ApiError && q.error.status === 403
            ? t("notPermitted")
            : t("loadFailed")}
        </p>
      </>
    );

  const { rows, options, can } = q.data;
  const name = (list: { id: string; name: string }[], id: string | null) =>
    id ? (list.find((u) => u.id === id)?.name ?? "—") : null;
  const unit = (r: CoverageRow) =>
    name(options.teams, r.teamId) ??
    name(options.departments, r.departmentId) ??
    name(options.directorates, r.directorateId) ??
    (r.companyWide ? t("wholeCompany") : t("anyUnit"));
  const who = (p: CoverageRow["owner"]) => (p ? (p.name ?? p.email) : "—");

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["hr-coverage"] });
  }
  async function remove(r: CoverageRow) {
    try {
      await apiClient.delete(`/api/hr-coverage/${r.id}`);
      success(t("removed"));
      await refresh();
    } catch (e) {
      notifyError(e instanceof ApiError ? e.message : t("saveFailed"));
    }
  }

  return (
    <>
      {header}
      <SectionCard
        title={t("listTitle")}
        subtitle={t("listNote")}
        noBodyPadding
        actions={
          <Button size="sm" onClick={() => setEditing("new")}>
            {t("add")}
          </Button>
        }
      >
        {rows.length === 0 ? (
          <EmptyState description={t("empty")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  {[
                    "company",
                    "unit",
                    "pair",
                    "words",
                    "owner",
                    "supervisor",
                    "caseTypes",
                    "priority",
                    "status",
                  ].map((k) => (
                    <th key={k} className="px-3 py-2 text-start font-medium">
                      {t(`col.${k}`)}
                    </th>
                  ))}
                  <th className="px-3 py-2">
                    <span className="sr-only">{t("col.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border align-top last:border-b-0">
                    <td className="px-3 py-2">
                      {name(options.companies, r.entityId) ?? t("anyCompany")}
                    </td>
                    <td className="px-3 py-2">{unit(r)}</td>
                    <td className="px-3 py-2">{r.pair?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {[r.label, ...r.aliases].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2">{who(r.owner)}</td>
                    <td className="px-3 py-2">{who(r.supervisor)}</td>
                    <td className="px-3 py-2">
                      {!r.owner
                        ? "—"
                        : r.caseTypes.length === 0
                          ? t("allTypes")
                          : r.caseTypes.map((c) => t(`caseType.${c}`)).join(", ")}
                    </td>
                    <td className="px-3 py-2">{r.owner ? r.priority : "—"}</td>
                    <td className="px-3 py-2">
                      <Badge variant={r.active ? "success" : "default"}>
                        {r.active ? t("active") : t("inactive")}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-end">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                        {t("edit")}
                      </Button>
                      <ConfirmAction
                        title={t("removeTitle")}
                        description={t("removeDescription")}
                        okText={t("remove")}
                        okType="danger"
                        onConfirm={() => void remove(r)}
                      >
                        <Button size="sm" variant="ghost">
                          {t("remove")}
                        </Button>
                      </ConfirmAction>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
      {can.jml && lookups.data ? <ResolvePreview lookups={lookups.data} /> : null}
      {editing ? (
        <HrCoverageDialog
          key={editing === "new" ? "new" : editing.id}
          row={editing === "new" ? null : editing}
          options={options}
          can={can}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            success(t("saved"));
            await refresh();
          }}
        />
      ) : null}
    </>
  );
}
