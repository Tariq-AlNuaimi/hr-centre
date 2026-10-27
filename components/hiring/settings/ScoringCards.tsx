"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/shared/SectionCard";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { Field } from "../ui/fields";
import { QueryState } from "../ui/states";
import type { GeneralView, Weights } from "./types";

const DIMS = ["skills", "experience", "education", "culture", "language"] as const;
export const GENERAL = "/api/hiring/settings/general";

export function useGeneral() {
  return useHiringQuery<GeneralView>(GENERAL);
}

/** Fit-scoring weights (must total 100). */
export function WeightsCard() {
  const t = useTranslations("hiring.settings");
  const q = useGeneral();
  return (
    <SectionCard title={t("weightsTitle")} subtitle={t("weightsHint")}>
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rows={3}>
        {q.data ? (
          <WeightsForm
            key={JSON.stringify(q.data.weights)}
            w={q.data.weights}
            canEdit={q.data.canEdit}
          />
        ) : null}
      </QueryState>
    </SectionCard>
  );
}

function WeightsForm({ w, canEdit }: { w: Weights; canEdit: boolean }) {
  const t = useTranslations("hiring.settings");
  const [f, setF] = useState(w);
  const save = useHiringMutation<object>("PUT", GENERAL, { success: t("saved") });
  const total = DIMS.reduce((s, k) => s + (Number.isFinite(f[k]) ? f[k] : 0), 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-5">
        {DIMS.map((k) => (
          <Field key={k} label={t(`dim.${k}`)} htmlFor={`w-${k}`}>
            <Input
              id={`w-${k}`}
              type="number"
              min={0}
              max={100}
              readOnly={!canEdit}
              value={f[k]}
              onChange={(e) => setF((p) => ({ ...p, [k]: Number(e.target.value) }))}
            />
          </Field>
        ))}
      </div>
      <p
        className={
          total === 100 ? "text-sm text-muted-foreground" : "text-sm text-destructive-emphasis"
        }
      >
        {t("weightsTotal", { total })}
      </p>
      {canEdit ? (
        <Button
          disabled={save.isPending || total !== 100}
          onClick={() => save.mutate({ section: "weights", value: f })}
        >
          {t("save")}
        </Button>
      ) : null}
    </div>
  );
}

/** When a panelist sees AI analysis and peers' scorecards. */
export function PanelModeCard() {
  const t = useTranslations("hiring.settings");
  const q = useGeneral();
  const save = useHiringMutation<object>("PUT", GENERAL, { success: t("saved") });
  return (
    <SectionCard title={t("panelTitle")} subtitle={t("panelHint")}>
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rows={3}>
        <fieldset className="space-y-2" disabled={!q.data?.canEdit || save.isPending}>
          <legend className="sr-only">{t("panelTitle")}</legend>
          {(["blind", "assisted", "off"] as const).map((m) => (
            <div key={m} className="flex items-start gap-2 text-sm">
              <input
                id={`pm-${m}`}
                type="radio"
                name="panel-mode"
                className="mt-1"
                aria-describedby={`pm-${m}-hint`}
                checked={q.data?.panelAiMode === m}
                onChange={() => save.mutate({ section: "panel", value: { mode: m } })}
              />
              <div>
                <label htmlFor={`pm-${m}`} className="font-medium">
                  {t(`mode.${m}`)}
                </label>
                <p id={`pm-${m}-hint`} className="text-muted-foreground">
                  {t(`mode.${m}Hint`)}
                </p>
              </div>
            </div>
          ))}
        </fieldset>
      </QueryState>
    </SectionCard>
  );
}
