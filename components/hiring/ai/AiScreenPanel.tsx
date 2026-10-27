"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hiringFetch, useHiringQuery } from "../ui/api";
import { Notice } from "../ui/states";

type Status = { pending: number; noProfile: number; configured: boolean };
type Chunk = { scored: number; failed: string[]; halted: boolean; remaining: number };
type Run = { scored: number; failed: number; done: boolean; halted: boolean; error: string | null };

/**
 * "Run AI screen" (Interview Hub bulk screen): scores every new applicant with
 * a CV profile and no score, a few per call, with live progress. A cap or the
 * kill-switch halts the run and says so; failures are counted, not hidden.
 */
export function AiScreenPanel({ requisitionId }: { requisitionId: string }) {
  const t = useTranslations("hiring.ai");
  const qc = useQueryClient();
  const q = useHiringQuery<Status>(`/api/hiring/requisitions/${requisitionId}/screening/ai`);
  const [run, setRun] = useState<Run | null>(null);
  const busy = run !== null && !run.done;

  async function start() {
    const skip: string[] = [];
    let total = { scored: 0, failed: 0 };
    setRun({ ...total, done: false, halted: false, error: null });
    try {
      for (let i = 0; i < 200; i++) {
        const r = await hiringFetch<Chunk>(
          `/api/hiring/requisitions/${requisitionId}/screening/ai`,
          {
            method: "POST",
            body: { skip },
          },
        );
        skip.push(...r.failed);
        total = { scored: total.scored + r.scored, failed: total.failed + r.failed.length };
        setRun({ ...total, done: false, halted: false, error: null });
        if (r.halted || r.remaining === 0 || r.scored + r.failed.length === 0) {
          setRun({ ...total, done: true, halted: r.halted, error: null });
          break;
        }
      }
    } catch (e) {
      setRun({ ...total, done: true, halted: false, error: (e as Error).message });
    } finally {
      void qc.invalidateQueries({ queryKey: ["hiring"] });
    }
  }

  const s = q.data;
  if (!s) return null;
  if (!s.configured) return <Notice>{t("screenNotConfigured")}</Notice>;
  return (
    <Notice
      tone={run?.error || run?.halted ? "warning" : "info"}
      title={t("screenTitle", { pending: s.pending })}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span>
          {run
            ? t(run.done ? "screenDone" : "screenProgress", {
                scored: run.scored,
                failed: run.failed,
              })
            : s.noProfile > 0
              ? t("screenNoProfile", { n: s.noProfile })
              : t("screenHint")}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || s.pending === 0}
          onClick={() => void start()}
        >
          <Sparkles className="h-4 w-4" />
          {busy ? t("running") : t("runScreen")}
        </Button>
      </div>
      {run?.halted ? <p className="mt-1">{t("screenHalted")}</p> : null}
      {run?.error ? <p className="mt-1">{run.error}</p> : null}
    </Notice>
  );
}
