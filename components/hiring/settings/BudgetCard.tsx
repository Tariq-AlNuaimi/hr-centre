"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/shared/SectionCard";
import { useHiringMutation } from "../ui/api";
import { Field } from "@/components/shared/FormControls";
import { QueryState } from "../ui/states";
import { GENERAL, useGeneral } from "./ScoringCards";
import type { BudgetEntry, GeneralView } from "./types";

type Row = { fiscalYear: string; amountOMR: string; setBy: string; setOn: string };
const toRow = (e?: BudgetEntry): Row => ({
  fiscalYear: e?.fiscalYear ?? "",
  amountOMR: e ? String(e.amountOMR) : "",
  setBy: e?.setBy ?? "",
  setOn: e?.setOn ?? "",
});

/** The headcount budget envelope per company, shown to approvers on the requisition (step 2). */
export function BudgetCard() {
  const t = useTranslations("hiring.settings");
  const q = useGeneral();
  return (
    <SectionCard title={t("budgetTitle")} subtitle={t("budgetHint")}>
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rows={4}>
        {q.data ? <BudgetForm key={JSON.stringify(q.data.budget)} g={q.data} /> : null}
      </QueryState>
    </SectionCard>
  );
}

function BudgetForm({ g }: { g: GeneralView }) {
  const t = useTranslations("hiring.settings");
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(g.entities.map((e) => [e.code, toRow(g.budget.entities[e.code])])),
  );
  const save = useHiringMutation<object>("PUT", GENERAL, { success: t("saved") });
  const ro = !g.canEdit;
  const set = (code: string, k: keyof Row, v: string) =>
    setRows((r) => ({ ...r, [code]: { ...r[code], [k]: v } }));
  function submit() {
    const entities: Record<string, BudgetEntry> = {};
    for (const [code, r] of Object.entries(rows)) {
      if (!r.fiscalYear.trim() && !r.amountOMR.trim()) continue;
      entities[code] = {
        fiscalYear: r.fiscalYear,
        amountOMR: Number(r.amountOMR),
        setBy: r.setBy,
        setOn: r.setOn,
      };
    }
    save.mutate({ section: "budget", value: { entities } });
  }
  return (
    <div className="space-y-4">
      {g.entities.map((e) => (
        <fieldset key={e.code} className="rounded-md border border-border p-3" disabled={ro}>
          <legend className="px-1 text-sm font-semibold">{e.name}</legend>
          <div className="grid gap-3 sm:grid-cols-4">
            {(["fiscalYear", "amountOMR", "setBy", "setOn"] as const).map((k) => (
              <Field key={k} label={t(`budget.${k}`)} htmlFor={`b-${e.code}-${k}`}>
                <Input
                  id={`b-${e.code}-${k}`}
                  type={k === "amountOMR" ? "number" : k === "setOn" ? "date" : "text"}
                  min={k === "amountOMR" ? 0 : undefined}
                  value={rows[e.code]?.[k] ?? ""}
                  onChange={(ev) => set(e.code, k, ev.target.value)}
                />
              </Field>
            ))}
          </div>
        </fieldset>
      ))}
      <p className="text-xs text-muted-foreground">{t("budgetEmpty")}</p>
      {ro ? null : (
        <Button disabled={save.isPending} onClick={submit}>
          {t("save")}
        </Button>
      )}
    </div>
  );
}
