"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { FilterBar, FilterSelect } from "@/components/shared/FilterBar";
import { PageHeader } from "@/components/shared/PageHeader";
import { useHiringMe } from "../ui/api";
import { useRequisitionOptions } from "../ui/requisition-options";
import { ViewSwitch } from "../candidates/ViewSwitch";
import { PipelineBoard } from "./PipelineBoard";

/** Requisitions whose candidates can be on the board. */
const LIVE = new Set(["OPEN", "REOPENED", "ON_HOLD", "PENDING_APPROVAL"]);

/**
 * `/hiring/pipeline` — the live board across every open requisition in scope,
 * filterable by requisition and hiring manager (server-side, UX P1-8).
 */
export function PipelineView() {
  const t = useTranslations("hiring.pipeline");
  const router = useRouter();
  const locale = useLocale();
  const { has } = useHiringMe();
  const { options } = useRequisitionOptions();
  const [requisitionId, setRequisitionId] = useState("");
  const [hiringManagerId, setHiringManagerId] = useState("");
  const reqs = useMemo(
    () =>
      options
        .filter((r) => LIVE.has(r.status))
        .filter((r) => !hiringManagerId || r.hiringManager?.id === hiringManagerId),
    [options, hiringManagerId],
  );
  const managers = useMemo(() => {
    const byId = new Map<string, string>();
    for (const r of options)
      if (r.hiringManager) byId.set(r.hiringManager.id, r.hiringManager.name);
    return [...byId]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [options]);
  const add = () => router.push(`/${locale}/hiring/candidates/new`);
  const filtered = Boolean(requisitionId || hiringManagerId);
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            <ViewSwitch active="board" />
            {has("hiring.manage") ? (
              <Button onClick={add}>
                <Plus className="h-4 w-4" />
                {t("add")}
              </Button>
            ) : null}
          </>
        }
      />
      <FilterBar>
        <FilterSelect
          id="board-requisition"
          label={t("filterRequisition")}
          allLabel={t("allRequisitions")}
          value={requisitionId}
          onChange={setRequisitionId}
          options={reqs.map((r) => ({ value: r.id, label: r.title }))}
        />
        <FilterSelect
          id="board-manager"
          label={t("filterManager")}
          allLabel={t("allManagers")}
          value={hiringManagerId}
          onChange={(v) => {
            setHiringManagerId(v);
            setRequisitionId("");
          }}
          options={managers}
        />
      </FilterBar>
      <PipelineBoard
        requisitionId={requisitionId || undefined}
        hiringManagerId={hiringManagerId || undefined}
        empty={
          filtered ? (
            <EmptyState description={t("emptyFiltered")} />
          ) : (
            <EmptyState
              description={t("empty")}
              actionLabel={has("hiring.manage") ? t("add") : undefined}
              onAction={add}
              actionVariant="outline"
            />
          )
        }
      />
    </div>
  );
}
