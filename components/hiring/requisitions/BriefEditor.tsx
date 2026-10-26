"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { CANONICAL_ROUND_ORDER, type RoundPlanEntry } from "@/lib/hiring/interview-rules";
import { useHiringMutation } from "../ui/api";
import { CompetencyPicker } from "../ui/competency-picker";
import { Field } from "../ui/fields";

type Draft = { round: string; competencies: string[]; durationMinutes: number };

/** Edit the interview brief: the rounds in order, each with its competencies and length. */
export function BriefEditor({
  requisitionId,
  plan,
  onClose,
}: {
  requisitionId: string;
  plan: RoundPlanEntry[];
  onClose: () => void;
}) {
  const t = useTranslations("hiring.schedule");
  const tr = useTranslations("hiring.round");
  const [draft, setDraft] = useState<Draft[]>(() =>
    plan.map((e) => ({
      round: e.round,
      competencies: e.competencies,
      durationMinutes: e.durationMinutes,
    })),
  );
  const save = useHiringMutation<{ rounds: Draft[] }>(
    "PUT",
    `/api/hiring/requisitions/${requisitionId}/interviews`,
    {
      success: t("briefSaved"),
      onSuccess: onClose,
    },
  );
  const available = CANONICAL_ROUND_ORDER.filter((r) => !draft.some((d) => d.round === r));
  const update = (i: number, patch: Partial<Draft>) =>
    setDraft((d) => d.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-screen max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("briefTitle")}</DialogTitle>
          <DialogDescription>{t("briefHint")}</DialogDescription>
        </DialogHeader>
        {draft.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noRoundsYet")}</p>
        ) : null}
        <ol className="space-y-3">
          {draft.map((row, i) => (
            <li key={row.round} className="space-y-3 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold">
                  {t("roundHeading", { n: i + 1, name: tr(row.round) })}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                  {t("removeRound")}
                </Button>
              </div>
              <Field label={t("competencies")} htmlFor={`bc-${i}`}>
                <CompetencyPicker
                  value={row.competencies}
                  onChange={(v) => update(i, { competencies: v.slice(0, 12) })}
                />
              </Field>
              <Field label={t("length")} htmlFor={`bl-${i}`}>
                <Input
                  id={`bl-${i}`}
                  type="number"
                  min={5}
                  max={480}
                  className="w-32"
                  value={row.durationMinutes}
                  onChange={(e) => update(i, { durationMinutes: Number(e.target.value) || 60 })}
                />
              </Field>
            </li>
          ))}
        </ol>
        {available.length ? (
          <NativeSelect
            aria-label={t("addRound")}
            value=""
            onChange={(e) =>
              e.target.value &&
              setDraft((d) => [
                ...d,
                { round: e.target.value, competencies: [], durationMinutes: 60 },
              ])
            }
          >
            <option value="">{t("addRound")}</option>
            {available.map((r) => (
              <option key={r} value={r}>
                {tr(r)}
              </option>
            ))}
          </NativeSelect>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate({ rounds: draft })}>
            {t("saveBrief")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
