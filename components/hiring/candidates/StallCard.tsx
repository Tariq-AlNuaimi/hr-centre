"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/org/NativeSelect";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDate } from "@/lib/format";
import { STALL_CAUSES } from "@/lib/validations/hiring/candidate";
import { useHiringMutation } from "../ui/api";
import { Field, Textarea } from "@/components/shared/FormControls";
import type { CandidateDetail } from "./types";

/**
 * Why this candidate is stuck where they are (Interview Hub's stall-cause API,
 * which had no screen). Counts only for the CURRENT stage: any move clears it.
 */
export function StallCard({ c }: { c: CandidateDetail }) {
  const t = useTranslations("hiring.stall");
  const [cause, setCause] = useState(c.stall?.cause ?? "");
  const [note, setNote] = useState(c.stall?.note ?? "");
  const save = useHiringMutation<{ cause: string | null; note?: string }>(
    "PATCH",
    `/api/hiring/candidates/${c.id}/stall-cause`,
    { success: t("saved") },
  );
  return (
    <SectionCard
      title={t("title")}
      subtitle={
        c.stall
          ? t("recorded", { by: c.stall.by?.name ?? "—", date: formatDate(c.stall.at) })
          : t("none")
      }
    >
      <div className="space-y-3">
        <Field label={t("cause")} htmlFor="stall-cause">
          <NativeSelect id="stall-cause" value={cause} onChange={(e) => setCause(e.target.value)}>
            <option value="">{t("noCause")}</option>
            {STALL_CAUSES.map((s) => (
              <option key={s} value={s}>
                {t(`causes.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {cause ? (
          <Field
            label={t("note")}
            htmlFor="stall-note"
            hint={cause === "OTHER" ? t("otherHint") : undefined}
          >
            <Textarea
              id="stall-note"
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        ) : null}
        <Button
          variant="outline"
          disabled={save.isPending || (cause === "OTHER" && !note.trim())}
          onClick={() =>
            save.mutate(cause ? { cause, note: note.trim() || undefined } : { cause: null })
          }
        >
          {cause ? t("save") : t("clear")}
        </Button>
      </div>
    </SectionCard>
  );
}
