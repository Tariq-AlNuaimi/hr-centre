"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/shared/SectionCard";
import { NativeSelect } from "@/components/org/NativeSelect";
import type { AssessmentConfig } from "@/lib/hiring/assessment-rules";
import { useHiringMutation } from "../ui/api";
import { Field } from "../ui/fields";

export type Policy = AssessmentConfig & {
  thresholdLocked: boolean;
  resultCount: number;
  mayEditPolicy: boolean;
};

/** The org-wide assessment policy: read for everyone here, editable by an HR Manager. */
export function AssessmentPolicy({ policy }: { policy: Policy }) {
  const t = useTranslations("hiring.assessment");
  const [editing, setEditing] = useState(false);
  return (
    <SectionCard
      title={t("policyTitle")}
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={!policy.mayEditPolicy}
          title={policy.mayEditPolicy ? undefined : t("policyLocked")}
          onClick={() => setEditing((e) => !e)}
        >
          <Settings2 className="h-4 w-4" />
          {editing ? t("cancel") : t("editPolicy")}
        </Button>
      }
    >
      {editing ? (
        <PolicyForm policy={policy} onDone={() => setEditing(false)} />
      ) : (
        <dl className="space-y-3 text-sm">
          <Row label={t("assessmentName")} value={policy.name} />
          <Row
            label={t("resultsUse")}
            value={t(`uses.${policy.resultsUse}`)}
            detail={
              policy.resultsUse === "ADVISORY"
                ? t("useAdvisoryDetail")
                : t("useCutoffDetail", { threshold: policy.passThreshold })
            }
          />
          <Row
            label={t("validity")}
            value={t("months", { count: policy.validityMonths })}
            detail={t("validityDetail")}
          />
          <Row
            label={t("thresholdChanges")}
            value={policy.thresholdLocked ? t("locked") : t("open")}
            detail={policy.thresholdLocked ? t("lockedDetail") : t("openDetail")}
          />
        </dl>
      )}
      <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
        {policy.resultsUse === "ADVISORY" ? t("processAdvisory") : t("processCutoff")}
      </p>
    </SectionCard>
  );
}

function Row({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div>
      <dt className="font-semibold text-foreground">{label}</dt>
      <dd className="text-foreground">
        {value}
        {detail ? <span className="text-muted-foreground"> — {detail}</span> : null}
      </dd>
    </div>
  );
}

function PolicyForm({ policy, onDone }: { policy: Policy; onDone: () => void }) {
  const t = useTranslations("hiring.assessment");
  const [v, setV] = useState<AssessmentConfig>({
    name: policy.name,
    resultsUse: policy.resultsUse,
    passThreshold: policy.passThreshold,
    validityMonths: policy.validityMonths,
  });
  const save = useHiringMutation<AssessmentConfig>("PUT", "/api/hiring/settings/assessment", {
    success: t("policySaved"),
    onSuccess: onDone,
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(v);
      }}
    >
      <Field label={t("assessmentName")} htmlFor="ap-name" required>
        <Input id="ap-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      </Field>
      <Field label={t("resultsUse")} htmlFor="ap-use">
        <NativeSelect
          id="ap-use"
          value={v.resultsUse}
          onChange={(e) =>
            setV({ ...v, resultsUse: e.target.value as AssessmentConfig["resultsUse"] })
          }
        >
          <option value="ADVISORY">{t("useADVISORYLong")}</option>
          <option value="HARD_CUTOFF">{t("useHARD_CUTOFFLong")}</option>
        </NativeSelect>
      </Field>
      <Field
        label={t("passThreshold")}
        htmlFor="ap-th"
        hint={
          policy.thresholdLocked
            ? t("thresholdLockedHint", { count: policy.resultCount })
            : t("openDetail")
        }
      >
        <Input
          id="ap-th"
          type="number"
          min={0}
          max={100}
          className="w-32"
          value={v.passThreshold}
          onChange={(e) => setV({ ...v, passThreshold: Number(e.target.value) })}
        />
      </Field>
      <Field label={t("validityMonths")} htmlFor="ap-val" hint={t("validityDetail")}>
        <Input
          id="ap-val"
          type="number"
          min={0}
          max={60}
          className="w-32"
          value={v.validityMonths}
          onChange={(e) => setV({ ...v, validityMonths: Number(e.target.value) })}
        />
      </Field>
      <Button type="submit" disabled={save.isPending || !v.name.trim()}>
        {t("savePolicy")}
      </Button>
    </form>
  );
}
