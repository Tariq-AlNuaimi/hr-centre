"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { SectionCard } from "@/components/shared/SectionCard";
import { CURRENCY_CODES } from "@/lib/hiring/money";
import { Check, Field } from "@/components/shared/FormControls";

type CompFields = {
  salaryCurrency: string;
  salaryBandMin: string;
  salaryBandMax: string;
  openings: string;
  targetCloseDate: string;
};

/** Compensation and timeline section of the requisition form. */
export function CompSection({
  f,
  set,
  bandHidden,
  locked,
  hmSeesSalary,
  setHmSeesSalary,
}: {
  f: CompFields;
  set: (k: keyof CompFields) => (v: string) => void;
  bandHidden: boolean;
  locked: boolean;
  hmSeesSalary: boolean;
  setHmSeesSalary: (v: boolean) => void;
}) {
  const t = useTranslations("hiring.requisitionForm");
  return (
    <SectionCard title={t("compSection")}>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t("currency")} htmlFor="rf-cur">
          <NativeSelect
            id="rf-cur"
            value={f.salaryCurrency}
            onChange={(e) => set("salaryCurrency")(e.target.value)}
          >
            {CURRENCY_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {bandHidden ? (
          <p className="text-sm text-muted-foreground md:col-span-2">{t("bandHidden")}</p>
        ) : (
          <>
            <Field label={t("bandMin")} htmlFor="rf-min" required>
              <Input
                id="rf-min"
                type="number"
                min={0}
                value={f.salaryBandMin}
                onChange={(e) => set("salaryBandMin")(e.target.value)}
              />
            </Field>
            <Field label={t("bandMax")} htmlFor="rf-max" required>
              <Input
                id="rf-max"
                type="number"
                min={0}
                value={f.salaryBandMax}
                onChange={(e) => set("salaryBandMax")(e.target.value)}
              />
            </Field>
          </>
        )}
        <Field label={t("openings")} htmlFor="rf-open">
          <Input
            id="rf-open"
            type="number"
            min={1}
            value={f.openings}
            disabled={locked}
            onChange={(e) => set("openings")(e.target.value)}
          />
        </Field>
        <Field label={t("targetClose")} htmlFor="rf-close" required>
          <Input
            id="rf-close"
            type="date"
            value={f.targetCloseDate}
            onChange={(e) => set("targetCloseDate")(e.target.value)}
          />
        </Field>
      </div>
      <div className="mt-4">
        <Check id="rf-hmsal" checked={hmSeesSalary} onChange={setHmSeesSalary}>
          {t("hmSeesSalary")}
        </Check>
      </div>
    </SectionCard>
  );
}
