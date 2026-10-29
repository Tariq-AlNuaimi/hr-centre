"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { Badge } from "@/components/ui/badge";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

type Kind = "people" | "jml.exits" | "hiring.candidates";
type Run = {
  id: string;
  kind: Kind;
  filename: string;
  status: "PREVIEWED" | "APPLIED" | "DISCARDED" | "FAILED";
  uploadedByEmail: string | null;
  uploadedBy: { name: string | null; email: string } | null;
  rowsTotal: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsRejected: number;
  createdAt: string;
};
type History = { kinds: Kind[]; data: Run[]; total: number };

/** Where each kind's importer lives (its own preview → apply screen). */
const IMPORTERS: Record<Kind, string | null> = {
  people: "/admin/import",
  "jml.exits": "/jml/settings/import-exits",
  // Candidate lists are imported from a requisition, so there is no single page.
  "hiring.candidates": null,
};
const KEY: Record<Kind, string> = {
  people: "people",
  "jml.exits": "exits",
  "hiring.candidates": "candidates",
};

export function ImportsHub() {
  const t = useTranslations("imports");
  const locale = useLocale();
  const q = useQuery({
    queryKey: ["imports-history"],
    queryFn: () => apiClient.get<History>("/api/imports/history?pageSize=50"),
    retry: false,
  });
  const header = <PageHeader title={t("title")} subtitle={t("subtitle")} />;
  if (q.isLoading)
    return (
      <div className="space-y-6">
        {header}
        <TableSkeleton rows={4} />
      </div>
    );
  if (q.isError || !q.data) {
    const denied = q.error instanceof ApiError && q.error.status === 403;
    return (
      <div className="space-y-6">
        {header}
        <EmptyState description={denied ? t("notPermitted") : t("loadFailed")} />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {header}
      <SectionCard title={t("importers")}>
        <ul className="grid gap-3 sm:grid-cols-3">
          {q.data.kinds.map((k) => (
            <li key={k} className="rounded-md border border-border p-4">
              <span className="block text-sm font-medium text-foreground">
                {t(`kind.${KEY[k]}.title`)}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {t(`kind.${KEY[k]}.note`)}
              </span>
              {IMPORTERS[k] ? (
                <Link
                  href={`/${locale}${IMPORTERS[k]}`}
                  className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline"
                >
                  {t("open")}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </SectionCard>
      <SectionCard title={t("history")} subtitle={t("historyNote")}>
        {q.data.data.length === 0 ? (
          <EmptyState description={t("none")} />
        ) : (
          <ul>
            {q.data.data.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-b-0"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="brand">{t(`kind.${KEY[r.kind]}.title`)}</Badge>
                    <Badge
                      variant={
                        r.status === "APPLIED"
                          ? "success"
                          : r.status === "FAILED"
                            ? "danger"
                            : "outline"
                      }
                    >
                      {t(`status.${r.status}`)}
                    </Badge>
                    <span className="truncate text-sm text-foreground">{r.filename}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("counts", {
                      total: r.rowsTotal,
                      created: r.rowsCreated,
                      updated: r.rowsUpdated,
                      rejected: r.rowsRejected,
                    })}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {t("by", {
                    who:
                      r.uploadedBy?.name ??
                      r.uploadedBy?.email ??
                      r.uploadedByEmail ??
                      t("unknown"),
                    date: formatDate(r.createdAt),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
