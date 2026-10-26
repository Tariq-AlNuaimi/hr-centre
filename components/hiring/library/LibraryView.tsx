"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { formatBand } from "@/lib/hiring/money";
import { cn } from "@/lib/utils";
import { qs, useHiringMe, useHiringMutation, useHiringQuery } from "../ui/api";
import { QueryState } from "../ui/states";
import { LIBRARY_COLUMNS } from "./config";
import { LibraryItemDialog } from "./LibraryItemDialog";

/**
 * The knowledge base (Interview Hub `KbPageShell` + KbTabs): competencies with
 * BARS anchors, grade bands, JD templates and the question bank — the
 * reference data AI scoring, requisitions and panels draw on.
 */
const KINDS = ["competencies", "grades", "jd-templates", "questions"];
export type LibraryRow = Record<string, unknown> & { id: string };

export function LibraryView({ kind }: { kind: string }) {
  const t = useTranslations("hiring.library");
  const locale = useLocale();
  const { has } = useHiringMe();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<LibraryRow | "new" | null>(null);
  const list = useHiringQuery<LibraryRow[]>(`/api/hiring/library/${kind}${qs({ search })}`);
  const remove = useHiringMutation<string>("DELETE", (id) => `/api/hiring/library/${kind}/${id}`, {
    success: t("deleted"),
  });
  const canEdit = has("hiring.manage");
  const cell = (row: LibraryRow, col: string) =>
    col === "band"
      ? formatBand(row.minSalary as number | null, row.maxSalary as number | null)
      : String(row[col] ?? "—");
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          canEdit ? (
            <Button onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" />
              {t(`new.${kind}`)}
            </Button>
          ) : null
        }
      />
      <nav aria-label={t("kinds")} className="flex flex-wrap gap-1 border-b border-border">
        {KINDS.map((k) => (
          <Link
            key={k}
            href={`/${locale}/hiring/library/${k}`}
            aria-current={k === kind ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              k === kind
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`kind.${k}`)}
          </Link>
        ))}
      </nav>
      <Input
        aria-label={t("search")}
        placeholder={t("search")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />
      <QueryState isLoading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
        <SectionCard title={t(`kind.${kind}`)} noBodyPadding>
          {list.data?.length === 0 ? <EmptyState description={t("empty")} /> : null}
          <ul className="divide-y divide-border">
            {(list.data ?? []).map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-sm"
              >
                <div className="grid min-w-0 flex-1 gap-1 md:grid-cols-4">
                  {LIBRARY_COLUMNS[kind].map((col, i) => (
                    <span
                      key={col}
                      className={
                        i === 0
                          ? "font-medium text-foreground md:col-span-2"
                          : "text-muted-foreground"
                      }
                    >
                      {cell(row, col)}
                    </span>
                  ))}
                </div>
                {canEdit ? (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                      {t("edit")}
                    </Button>
                    <ConfirmAction
                      title={t("deleteConfirm")}
                      onConfirm={() => remove.mutate(row.id)}
                    >
                      <Button size="sm" variant="ghost">
                        {t("delete")}
                      </Button>
                    </ConfirmAction>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </SectionCard>
      </QueryState>
      {editing ? (
        <LibraryItemDialog
          kind={kind}
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
