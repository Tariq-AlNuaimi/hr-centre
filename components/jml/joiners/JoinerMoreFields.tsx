"use client";

import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/org/NativeSelect";
import { EmployeePicker } from "@/components/pms/EmployeePicker";
import { Field } from "../Field";
import type { Lookups } from "../use-jml";
import { EMPLOYMENT_TYPES, Text, Tri, type JoinerValues, type SetFn } from "./JoinerFields";

/** The joiner form's Employment, Pay, IT and Introduction sections (Onboarding FormFields). */

export function EmploymentSection({
  v,
  set,
  lookups,
  startLocked,
}: {
  v: JoinerValues;
  set: SetFn;
  lookups: Lookups;
  startLocked: boolean;
}) {
  const t = useTranslations("jml.joiners.form");
  const tc = useTranslations("people.record.contract");
  const notOffered = new Set(
    lookups.employmentTypes.filter((c) => !c.active).map((c) => c.employmentType),
  );
  return (
    <SectionCard title={t("section.employment")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Text
          id="j-title"
          label={t("jobTitle")}
          value={v.jobTitle}
          onChange={(x) => set("jobTitle", x)}
        />
        <Field id="j-etype" label={t("employmentType")}>
          <NativeSelect
            id="j-etype"
            className="w-full"
            value={v.employmentType}
            onChange={(e) => set("employmentType", e.target.value)}
          >
            <option value="">{t("choose")}</option>
            {EMPLOYMENT_TYPES.filter((e) => !notOffered.has(e) || e === v.employmentType).map(
              (e) => (
                <option key={e} value={e}>
                  {tc(e)}
                </option>
              ),
            )}
          </NativeSelect>
        </Field>
        <Field
          id="j-ctype"
          label={t("contractType")}
          hint={lookups.contractTypes.length === 0 ? t("noContractTypes") : undefined}
        >
          <NativeSelect
            id="j-ctype"
            className="w-full"
            value={v.contractTypeId}
            onChange={(e) => set("contractTypeId", e.target.value)}
          >
            <option value="">{t("choose")}</option>
            {lookups.contractTypes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Text
          id="j-start"
          label={t("plannedStartDate")}
          type="date"
          value={v.plannedStartDate}
          onChange={(x) => (startLocked ? undefined : set("plannedStartDate", x))}
          hint={startLocked ? t("startLocked") : undefined}
        />
        <Text
          id="j-cstart"
          label={t("contractStartDate")}
          type="date"
          value={v.contractStartDate}
          onChange={(x) => set("contractStartDate", x)}
        />
        <Text
          id="j-cend"
          label={t("contractEndDate")}
          type="date"
          value={v.contractEndDate}
          onChange={(x) => set("contractEndDate", x)}
        />
        <Text
          id="j-prob"
          label={t("probationMonths")}
          type="number"
          value={v.probationMonths}
          onChange={(x) => set("probationMonths", x)}
        />
        <Text
          id="j-loc"
          label={t("workLocation")}
          value={v.workLocation}
          onChange={(x) => set("workLocation", x)}
        />
        <Tri
          id="j-client"
          label={t("clientAssignedRole")}
          value={v.clientAssignedRole}
          onChange={(x) => set("clientAssignedRole", x)}
        />
        <div>
          {v.manager ? (
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{t("lineManager")}</p>
              <div className="flex items-center gap-2 text-sm">
                {v.manager.name}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => set("manager", null)}
                >
                  {t("changeManager")}
                </Button>
              </div>
            </div>
          ) : (
            <EmployeePicker
              id="j-manager"
              label={t("lineManager")}
              onPick={(p) => set("manager", { id: p.id, name: p.name })}
            />
          )}
        </div>
      </div>
    </SectionCard>
  );
}

export function PaySection({
  v,
  set,
  salaryAllowed,
}: {
  v: JoinerValues;
  set: SetFn;
  salaryAllowed: boolean;
}) {
  const t = useTranslations("jml.joiners.form");
  return (
    <SectionCard title={t("section.pay")} subtitle={t("payNote")}>
      <div className="grid gap-4 sm:grid-cols-2">
        {salaryAllowed ? (
          <Text
            id="j-salary"
            label={t("salary")}
            value={v.salary}
            onChange={(x) => set("salary", x)}
            hint={t("salaryHint")}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t("salaryHidden")}</p>
        )}
        <Field id="j-payroll" label={t("payrollApplicable")}>
          <NativeSelect
            id="j-payroll"
            className="w-full"
            value={v.payrollApplicable ? "yes" : "no"}
            onChange={(e) => set("payrollApplicable", e.target.value === "yes")}
          >
            <option value="yes">{t("yes")}</option>
            <option value="no">{t("no")}</option>
          </NativeSelect>
        </Field>
      </div>
    </SectionCard>
  );
}

export function ItSection({ v, set }: { v: JoinerValues; set: SetFn }) {
  const t = useTranslations("jml.joiners.form");
  return (
    <SectionCard title={t("section.it")} subtitle={t("itNote")}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Tri
          id="j-ms"
          label={t("msAccountRequired")}
          value={v.msAccountRequired}
          onChange={(x) => set("msAccountRequired", x)}
        />
        <Tri
          id="j-laptop"
          label={t("laptopRequired")}
          value={v.laptopRequired}
          onChange={(x) => set("laptopRequired", x)}
        />
        <Tri
          id="j-card"
          label={t("accessCardRequired")}
          value={v.accessCardRequired}
          onChange={(x) => set("accessCardRequired", x)}
        />
      </div>
    </SectionCard>
  );
}

export function IntroSection({ v, set }: { v: JoinerValues; set: SetFn }) {
  const t = useTranslations("jml.joiners.form");
  return (
    <SectionCard title={t("section.intro")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="j-intro" label={t("introSentence")}>
          <textarea
            id="j-intro"
            className="min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm"
            value={v.introSentence}
            onChange={(e) => set("introSentence", e.target.value)}
          />
        </Field>
        <Field id="j-hobbies" label={t("hobbies")}>
          <textarea
            id="j-hobbies"
            className="min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm"
            value={v.hobbies}
            onChange={(e) => set("hobbies", e.target.value)}
          />
        </Field>
      </div>
    </SectionCard>
  );
}
