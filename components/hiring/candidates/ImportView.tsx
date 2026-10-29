"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Field } from "@/components/shared/FormControls";
import { useRequisitionOptions } from "../ui/requisition-options";
import { Notice } from "../ui/states";

type Result = {
  created: number;
  failed: number;
  errors: { row: number; name: string; error: string }[];
};

/**
 * `/hiring/import` — a spreadsheet of candidates into one requisition
 * (Interview Hub `/import`). Row 1 is the header; Name is required; Email,
 * Phone and Employer are read when present. ≤ 500 rows, first sheet only.
 */
export function ImportView() {
  const t = useTranslations("hiring.import");
  const search = useSearchParams();
  const qc = useQueryClient();
  const { options } = useRequisitionOptions();
  const [requisitionId, setRequisitionId] = useState(search.get("requisitionId") ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function run() {
    if (!file || !requisitionId) return;
    setBusy(true);
    setResult(null);
    try {
      const body = new FormData();
      body.append("requisitionId", requisitionId);
      body.append("file", file);
      const res = await fetch("/api/hiring/candidates/import", { method: "POST", body });
      const json = (await res.json().catch(() => null)) as { data?: Result; error?: string } | null;
      if (!res.ok || !json?.data) throw new Error(json?.error ?? t("failed"));
      setResult(json.data);
      toast.success(t("imported", { count: json.data.created }));
      void qc.invalidateQueries({ queryKey: ["hiring"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <SectionCard title={t("source")}>
            <Field label={t("file")} htmlFor="imp-file" hint={t("fileHint")}>
              <Input
                id="imp-file"
                type="file"
                accept=".xlsx"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setResult(null);
                }}
              />
            </Field>
          </SectionCard>
          <SectionCard title={t("assignTo")}>
            <div className="space-y-3">
              <Field label={t("requisition")} htmlFor="imp-req">
                <NativeSelect
                  id="imp-req"
                  value={requisitionId}
                  onChange={(e) => setRequisitionId(e.target.value)}
                >
                  <option value="">{t("chooseRequisition")}</option>
                  {options.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Button
                className="w-full"
                disabled={busy || !requisitionId || !file}
                onClick={() => void run()}
              >
                {t("run")}
              </Button>
              {!requisitionId ? (
                <p className="text-xs text-muted-foreground">{t("needRequisition")}</p>
              ) : null}
            </div>
          </SectionCard>
          <Notice tone="info" title={t("columnsTitle")}>
            {t("columnsBody")}
          </Notice>
        </div>
        <div className="lg:col-span-2">
          <SectionCard
            title={
              result
                ? t("resultTitle", { count: result.created + result.failed })
                : t("previewTitle")
            }
            subtitle={
              result
                ? t("resultSummary", { created: result.created, failed: result.failed })
                : t("previewHint")
            }
          >
            {!result ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {result.created > 0 ? (
                  <li className="flex items-center gap-2 py-3 text-sm font-semibold">
                    <CheckCircle2 aria-hidden className="h-4 w-4 text-status-ok-fg" />
                    {t("createdRow", { count: result.created })}
                    <span className="flex-1" />
                    <Badge variant="success">{t("ready")}</Badge>
                  </li>
                ) : null}
                {result.errors.map((e) => (
                  <li key={e.row} className="flex items-center gap-3 py-3 text-sm">
                    <span className="font-semibold">{e.name || t("rowN", { row: e.row })}</span>
                    <span className="flex-1 font-mono text-xs text-status-warn-fg">
                      {t("rowError", { row: e.row, error: e.error })}
                    </span>
                    <Badge variant="warning">{t("needsReview")}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
