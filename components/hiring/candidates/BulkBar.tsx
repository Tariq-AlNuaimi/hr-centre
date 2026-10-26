"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Shuffle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/org/NativeSelect";
import { PIPELINE_STAGES } from "@/lib/hiring/stage-rules";
import { useHiringMutation } from "../ui/api";

type Summary = { requested: number; processed: number; skipped: number; failed: number };

/**
 * Bulk actions on a selection (≤500): move to a stage, or export. A governed
 * move (reject past the first interview, a regression, a phase cross, a
 * skipped mandatory step) is skipped by the server and counted here.
 */
export function BulkBar({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  const t = useTranslations("hiring.candidates");
  const ts = useTranslations("hiring.stage");
  const [stage, setStage] = useState("");
  const [exporting, setExporting] = useState(false);
  const move = useHiringMutation<object, Summary>("POST", "/api/hiring/candidates/bulk", {
    onSuccess: (s) => {
      toast.success(
        t("bulkDone", { processed: s.processed, skipped: s.skipped, failed: s.failed }),
      );
      setStage("");
      onClear();
    },
  });
  async function exportSelected() {
    setExporting(true);
    try {
      const res = await fetch("/api/hiring/candidates/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "export", candidateIds: ids }),
      });
      if (!res.ok)
        throw new Error(
          ((await res.json().catch(() => null)) as { error?: string } | null)?.error ??
            t("exportFailed"),
        );
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "candidates-selected.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("exported", { count: ids.length }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-primary/40 bg-accent-subtle px-4 py-2">
      <span className="text-sm font-semibold">{t("selected", { count: ids.length })}</span>
      <div className="flex items-center gap-1">
        <NativeSelect
          aria-label={t("bulkMoveLabel")}
          value={stage}
          onChange={(e) => setStage(e.target.value)}
        >
          <option value="">{t("bulkMovePlaceholder")}</option>
          {PIPELINE_STAGES.map((s) => (
            <option key={s} value={s}>
              {ts(s)}
            </option>
          ))}
        </NativeSelect>
        <Button
          size="sm"
          variant="outline"
          disabled={!stage || move.isPending}
          onClick={() => move.mutate({ action: "stage_move", candidateIds: ids, stage })}
        >
          <Shuffle className="h-4 w-4" />
          {t("apply")}
        </Button>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={exporting}
        onClick={() => void exportSelected()}
      >
        <Download className="h-4 w-4" />
        {t("exportSelected")}
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear}>
        {t("clear")}
      </Button>
    </div>
  );
}
