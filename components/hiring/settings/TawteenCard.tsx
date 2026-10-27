"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/shared/SectionCard";
import { useHiringMutation } from "../ui/api";
import { Field } from "../ui/fields";
import { QueryState } from "../ui/states";
import { GENERAL, useGeneral } from "./ScoringCards";
import type { GeneralView } from "./types";

/** Omanization (Tawteen) target per company, the line Hiring insights measure against. */
export function TawteenCard() {
  const t = useTranslations("hiring.settings");
  const q = useGeneral();
  return (
    <SectionCard title={t("tawteenTitle")} subtitle={t("tawteenHint")}>
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rows={3}>
        {q.data ? <TawteenForm key={JSON.stringify(q.data.tawteen)} g={q.data} /> : null}
      </QueryState>
    </SectionCard>
  );
}

function TawteenForm({ g }: { g: GeneralView }) {
  const t = useTranslations("hiring.settings");
  const [f, setF] = useState<Record<string, string>>(() =>
    Object.fromEntries(g.entities.map((e) => [e.code, String(g.tawteen.targets[e.code] ?? "")])),
  );
  const save = useHiringMutation<object>("PUT", GENERAL, { success: t("saved") });
  function submit() {
    const targets: Record<string, number> = {};
    for (const [code, v] of Object.entries(f))
      if (v.trim() !== "") targets[code] = Math.round(Number(v));
    save.mutate({ section: "tawteen", value: { targets } });
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {g.entities.map((e) => (
          <Field key={e.code} label={e.name} htmlFor={`tw-${e.code}`} hint={t("tawteenField")}>
            <Input
              id={`tw-${e.code}`}
              type="number"
              min={0}
              max={100}
              readOnly={!g.canEdit}
              value={f[e.code] ?? ""}
              onChange={(ev) => setF((p) => ({ ...p, [e.code]: ev.target.value }))}
            />
          </Field>
        ))}
      </div>
      {g.canEdit ? (
        <Button disabled={save.isPending} onClick={submit}>
          {t("save")}
        </Button>
      ) : null}
    </div>
  );
}
