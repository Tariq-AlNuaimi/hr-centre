"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { Field } from "../Field";
import { DEFAULT_NOTICE, EXIT_SUBTYPES, EXIT_TYPES, type ExitValues } from "./exit-values";

/**
 * The exit type, branch and three-date model (Offboarding §6.2): LPWD ≥ notice
 * start, LDS ≥ LPWD (the gap is terminal leave), a departure date only for an
 * expatriate. The server re-checks every rule and names what is wrong.
 */
export function ExitDateFields({
  values,
  onChange,
  nationalityOptional = false,
}: {
  values: ExitValues;
  onChange: (next: ExitValues) => void;
  /** On creation the branch defaults from the employee record. */
  nationalityOptional?: boolean;
}) {
  const t = useTranslations("jml.leavers.form");
  const tv = useTranslations("jml.leavers.vocab");
  const set = (patch: Partial<ExitValues>) => onChange({ ...values, ...patch });
  const overridden = Number(values.noticePeriodDays || 0) !== DEFAULT_NOTICE[values.exitType];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id="exit-type" label={t("exitType")}>
        <NativeSelect
          id="exit-type"
          className="w-full"
          value={values.exitType}
          onChange={(e) =>
            set({
              exitType: e.target.value,
              noticePeriodDays: String(DEFAULT_NOTICE[e.target.value] ?? 0),
            })
          }
        >
          {EXIT_TYPES.map((x) => (
            <option key={x} value={x}>
              {tv(`exitType.${x}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {values.exitType === "TERMINATION" ? (
        <Field id="exit-subtype" label={t("exitSubtype")}>
          <NativeSelect
            id="exit-subtype"
            className="w-full"
            value={values.exitSubtype}
            onChange={(e) => set({ exitSubtype: e.target.value })}
          >
            <option value="">{t("choose")}</option>
            {EXIT_SUBTYPES.map((x) => (
              <option key={x} value={x}>
                {tv(`exitSubtype.${x}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : null}
      <Field
        id="exit-nat"
        label={t("nationality")}
        hint={nationalityOptional ? t("nationalityHint") : undefined}
      >
        <NativeSelect
          id="exit-nat"
          className="w-full"
          value={values.nationality}
          onChange={(e) => set({ nationality: e.target.value })}
        >
          {nationalityOptional ? <option value="">{t("fromRecord")}</option> : null}
          <option value="OMANI">{tv("nationality.OMANI")}</option>
          <option value="EXPATRIATE">{tv("nationality.EXPATRIATE")}</option>
        </NativeSelect>
      </Field>
      <Field id="exit-ns" label={t("noticeStart")}>
        <Input
          id="exit-ns"
          type="date"
          value={values.noticeStartDate}
          onChange={(e) => set({ noticeStartDate: e.target.value })}
        />
      </Field>
      <Field
        id="exit-days"
        label={t("noticeDays")}
        hint={t("noticeDefault", { days: DEFAULT_NOTICE[values.exitType] ?? 0 })}
      >
        <Input
          id="exit-days"
          type="number"
          min={0}
          max={365}
          value={values.noticePeriodDays}
          onChange={(e) => set({ noticePeriodDays: e.target.value })}
        />
      </Field>
      {overridden ? (
        <Field id="exit-override" label={t("overrideReason")}>
          <Input
            id="exit-override"
            value={values.noticePeriodOverrideReason}
            onChange={(e) => set({ noticePeriodOverrideReason: e.target.value })}
          />
        </Field>
      ) : null}
      <Field id="exit-lpwd" label={t("lpwd")} hint={t("lpwdHint")}>
        <Input
          id="exit-lpwd"
          type="date"
          value={values.lastPhysicalWorkingDay}
          onChange={(e) => set({ lastPhysicalWorkingDay: e.target.value })}
        />
      </Field>
      <Field id="exit-lds" label={t("lds")} hint={t("ldsHint")}>
        <Input
          id="exit-lds"
          type="date"
          value={values.lastDayOfService}
          onChange={(e) => set({ lastDayOfService: e.target.value })}
        />
      </Field>
      {values.nationality !== "OMANI" ? (
        <Field id="exit-dep" label={t("departure")} hint={t("departureHint")}>
          <Input
            id="exit-dep"
            type="date"
            value={values.departureDate}
            onChange={(e) => set({ departureDate: e.target.value })}
          />
        </Field>
      ) : null}
    </div>
  );
}
