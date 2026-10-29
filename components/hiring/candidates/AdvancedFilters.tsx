"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NativeSelect } from "@/components/org/NativeSelect";
import { Field } from "@/components/shared/FormControls";

export type AdvancedValues = {
  grade?: string;
  scoreMin?: string;
  scoreMax?: string;
  interviewCountMin?: string;
  interviewCountMax?: string;
  createdFrom?: string;
  createdTo?: string;
};

/** More filters (Interview Hub CandidatesAdvancedFilters): grade, fit range, interviews, applied. */
export function AdvancedFilters({
  value,
  onApply,
  grades,
  canFilterScore,
}: {
  value: AdvancedValues;
  onApply: (v: AdvancedValues) => void;
  grades: { code: string; name: string }[];
  canFilterScore: boolean;
}) {
  const t = useTranslations("hiring.candidates");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AdvancedValues>(value);
  const active = Object.values(value).filter(Boolean).length;
  const set = (k: keyof AdvancedValues) => (e: { target: { value: string } }) =>
    setDraft({ ...draft, [k]: e.target.value || undefined });
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(value);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline">
          <SlidersHorizontal className="h-4 w-4" />
          {active ? t("moreFiltersActive", { count: active }) : t("moreFilters")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3">
        <Field label={t("grade")} htmlFor="af-grade">
          <NativeSelect id="af-grade" value={draft.grade ?? ""} onChange={set("grade")}>
            <option value="">{t("anyGrade")}</option>
            {grades.map((g) => (
              <option key={g.code} value={g.code}>
                {g.name ? `${g.code} — ${g.name}` : g.code}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {canFilterScore ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("scoreMin")} htmlFor="af-smin">
              <Input
                id="af-smin"
                type="number"
                min={0}
                max={100}
                value={draft.scoreMin ?? ""}
                onChange={set("scoreMin")}
              />
            </Field>
            <Field label={t("scoreMax")} htmlFor="af-smax">
              <Input
                id="af-smax"
                type="number"
                min={0}
                max={100}
                value={draft.scoreMax ?? ""}
                onChange={set("scoreMax")}
              />
            </Field>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("interviewsMin")} htmlFor="af-imin">
            <Input
              id="af-imin"
              type="number"
              min={0}
              max={100}
              value={draft.interviewCountMin ?? ""}
              onChange={set("interviewCountMin")}
            />
          </Field>
          <Field label={t("interviewsMax")} htmlFor="af-imax">
            <Input
              id="af-imax"
              type="number"
              min={0}
              max={100}
              value={draft.interviewCountMax ?? ""}
              onChange={set("interviewCountMax")}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("appliedFrom")} htmlFor="af-from">
            <Input
              id="af-from"
              type="date"
              value={draft.createdFrom ?? ""}
              onChange={set("createdFrom")}
            />
          </Field>
          <Field label={t("appliedTo")} htmlFor="af-to">
            <Input
              id="af-to"
              type="date"
              value={draft.createdTo ?? ""}
              onChange={set("createdTo")}
            />
          </Field>
        </div>
        <div className="flex justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              onApply({});
              setOpen(false);
            }}
          >
            {t("clearFilters")}
          </Button>
          <Button
            onClick={() => {
              onApply(draft);
              setOpen(false);
            }}
          >
            {t("applyFilters")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
