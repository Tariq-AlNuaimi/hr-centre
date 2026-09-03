"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * §6.2 / §7.1 / §8.7 — the three clauses the specification leaves open, as a
 * form HR fills in.
 *
 * Each control is labelled with the clause it answers, says what the system
 * does under the current answer, AND says what the other answer would mean.
 * That last part is not padding: these are policy decisions with consequences a
 * reader cannot infer from the switch's name. §8.7's rounding option decides,
 * at one boundary, whether a person's bonus coefficient is 2.0x or 1.5x
 * (§11.3), and a checkbox labelled "round scores" hides that completely.
 *
 * Read-only once the cycle is OPEN, and the panel says why rather than simply
 * greying out — people have already signed and rated under these rules, so
 * moving them would invalidate work already done. The route is the real gate
 * (a disabled input is a courtesy, not a control); this is the explanation.
 */

export type CyclePolicyValues = {
  requireResignAfterChange: boolean;
  divergenceReason: "REQUIRED" | "OPTIONAL" | "OFF";
  roundScoreBeforeBanding: boolean;
};

/** A yes/no policy, rendered as a select so both answers are visible at once. */
function BooleanPolicy(props: {
  id: string;
  label: string;
  help: string;
  yesLabel: string;
  noLabel: string;
  value: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Select
        value={props.value ? "yes" : "no"}
        disabled={props.disabled}
        onValueChange={(v) => props.onChange(v === "yes")}
      >
        <SelectTrigger id={props.id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="no">{props.noLabel}</SelectItem>
          <SelectItem value="yes">{props.yesLabel}</SelectItem>
        </SelectContent>
      </Select>
      <p className="max-w-prose text-xs text-muted-foreground">{props.help}</p>
    </div>
  );
}

export function CyclePolicyForm({
  formId,
  value,
  editable,
  submitting,
  onSubmit,
}: {
  formId: string;
  value: CyclePolicyValues;
  /** False once the cycle leaves DRAFT — see the note above. */
  editable: boolean;
  submitting: boolean;
  onSubmit: (values: CyclePolicyValues) => void;
}) {
  const t = useTranslations("pms.cyclePolicy");
  const [draft, setDraft] = useState<CyclePolicyValues>(value);

  // The server's answer wins whenever it changes — a refetch after a save, or a
  // different cycle opened in the same dialog.
  useEffect(() => setDraft(value), [value]);

  const disabled = !editable || submitting;

  return (
    <form
      id={formId}
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
    >
      {!editable ? (
        <p role="status" className="max-w-prose text-sm text-muted-foreground">
          {t("frozen")}
        </p>
      ) : null}

      <BooleanPolicy
        id={`${formId}-resign`}
        label={t("resign.label")}
        help={draft.requireResignAfterChange ? t("resign.helpYes") : t("resign.helpNo")}
        noLabel={t("resign.no")}
        yesLabel={t("resign.yes")}
        value={draft.requireResignAfterChange}
        disabled={disabled}
        onChange={(requireResignAfterChange) =>
          setDraft((d) => ({ ...d, requireResignAfterChange }))
        }
      />

      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-divergence`}>{t("divergence.label")}</Label>
        <Select
          value={draft.divergenceReason}
          disabled={disabled}
          onValueChange={(v) =>
            setDraft((d) => ({
              ...d,
              divergenceReason: v as CyclePolicyValues["divergenceReason"],
            }))
          }
        >
          <SelectTrigger id={`${formId}-divergence`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="REQUIRED">{t("divergence.required")}</SelectItem>
            <SelectItem value="OPTIONAL">{t("divergence.optional")}</SelectItem>
            <SelectItem value="OFF">{t("divergence.off")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="max-w-prose text-xs text-muted-foreground">
          {t(`divergence.help.${draft.divergenceReason}`)}
        </p>
      </div>

      <BooleanPolicy
        id={`${formId}-rounding`}
        label={t("rounding.label")}
        help={draft.roundScoreBeforeBanding ? t("rounding.helpYes") : t("rounding.helpNo")}
        noLabel={t("rounding.no")}
        yesLabel={t("rounding.yes")}
        value={draft.roundScoreBeforeBanding}
        disabled={disabled}
        onChange={(roundScoreBeforeBanding) => setDraft((d) => ({ ...d, roundScoreBeforeBanding }))}
      />

      {/* The submit lives in the dialog footer; this keeps the form usable on
          its own (and keyboard-submittable) without rendering a second button. */}
      <Button type="submit" className="sr-only" disabled={disabled}>
        {t("save")}
      </Button>
    </form>
  );
}
