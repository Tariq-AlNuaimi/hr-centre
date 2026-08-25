"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { Form, TextField, useZodForm } from "@/components/shared/FormField";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * The KPI authoring form — spec §5.2: "description, weightage %, and five level
 * descriptors — Outstanding 5, Excellent 4, Target 3, Almost Achieved 2,
 * Unsatisfactory 1."
 *
 * All six texts are required, here and at the API (`lib/validations/kpi.ts`) and
 * in the database (`kpis_texts_not_blank_check`). A KPI whose "Outstanding" is
 * blank reaches the employee as an unlabelled rating scale, so none of the three
 * layers treats it as optional.
 *
 * WHY THE FORM IS ALL STRINGS — the same reasoning as CycleForm. The API schema
 * coerces `weightage` to a number; an empty number input coerces to `0`, which
 * is a real answer to a question nobody answered. This schema speaks the input's
 * vocabulary and converts once, at submit.
 *
 * WHAT THIS FORM DOES NOT DO: refuse a set that is short of 100%. §5.3 is a
 * SET-level rule enforced at sign-off, not per keystroke — a draft legitimately
 * sits at 80% while a manager is still writing. The gap is SHOWN by the board
 * above this form; it never blocks a save.
 */

/** §5.2's five levels, in the order the spec lists them, with its numeric values. */
export const KPI_LEVEL_FIELDS = [
  { field: "descriptorOutstanding", value: 5 },
  { field: "descriptorExcellent", value: 4 },
  { field: "descriptorTarget", value: 3 },
  { field: "descriptorAlmostAchieved", value: 2 },
  { field: "descriptorUnsatisfactory", value: 1 },
] as const;

export type KpiLevelField = (typeof KPI_LEVEL_FIELDS)[number]["field"];

/** The six texts, plus the weightage as the API delivers it: a decimal STRING. */
export interface KpiFormInitial {
  description: string;
  weightage: string;
  descriptorOutstanding: string;
  descriptorExcellent: string;
  descriptorTarget: string;
  descriptorAlmostAchieved: string;
  descriptorUnsatisfactory: string;
}

/** What the form emits: the same six texts, weightage as the number the API takes. */
export type KpiFormValues = Omit<KpiFormInitial, "weightage"> & { weightage: number };

/** Percent with at most two decimals — the shape `Decimal(5,2)` can hold. */
const WEIGHTAGE_INPUT = /^\d{1,3}(\.\d{1,2})?$/;

const TEXTAREA_CLASS =
  "flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm " +
  "text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground " +
  "focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 " +
  "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive";

/**
 * A labelled multi-line field. The shipped `TextField` wraps a single-line
 * `Input`, and every one of §5.2's six texts is a sentence about behaviour — a
 * one-line box invites a one-word descriptor, which is exactly the unusable
 * rating scale the not-blank constraint exists to prevent. Same primitives
 * (`FormItem`/`FormLabel`/`FormControl`/`FormMessage`), same accessible wiring,
 * same on-token surface as `Input`.
 */
function TextAreaField({
  name,
  label,
  description,
  badge,
  rows = 2,
  disabled,
}: {
  name: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  rows?: number;
  disabled?: boolean;
}) {
  return (
    <FormField
      name={name}
      render={({ field }) => (
        <FormItem>
          <div className="flex flex-wrap items-center gap-2">
            <FormLabel>{label}</FormLabel>
            {badge}
          </div>
          <FormControl>
            <textarea
              {...field}
              rows={rows}
              disabled={disabled}
              value={field.value ?? ""}
              className={cn(TEXTAREA_CLASS)}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

interface KpiFormProps {
  /** Ties the dialog footer's submit button to this form (`form="…"`). */
  formId: string;
  initial?: KpiFormInitial;
  submitting?: boolean;
  onSubmit: (values: KpiFormValues) => void;
}

export function KpiForm({ formId, initial, submitting, onSubmit }: KpiFormProps) {
  const t = useTranslations("pms.kpi");

  const schema = useMemo(() => {
    const text = z
      .string()
      .trim()
      .min(1, { message: t("validation.descriptorRequired") })
      .max(2000, { message: t("validation.tooLong") });

    return z.object({
      description: z
        .string()
        .trim()
        .min(1, { message: t("validation.descriptionRequired") })
        .max(2000, { message: t("validation.tooLong") }),
      weightage: z.string().refine((v) => WEIGHTAGE_INPUT.test(v) && Number(v) <= 100, {
        message: t("validation.weightage"),
      }),
      descriptorOutstanding: text,
      descriptorExcellent: text,
      descriptorTarget: text,
      descriptorAlmostAchieved: text,
      descriptorUnsatisfactory: text,
    });
  }, [t]);

  const form = useZodForm(schema, {
    defaultValues: {
      description: initial?.description ?? "",
      // An existing weightage arrives as a decimal string from the API and goes
      // back as one — it is never round-tripped through a float.
      weightage: initial?.weightage ?? "",
      descriptorOutstanding: initial?.descriptorOutstanding ?? "",
      descriptorExcellent: initial?.descriptorExcellent ?? "",
      descriptorTarget: initial?.descriptorTarget ?? "",
      descriptorAlmostAchieved: initial?.descriptorAlmostAchieved ?? "",
      descriptorUnsatisfactory: initial?.descriptorUnsatisfactory ?? "",
    },
  });

  return (
    <Form {...form}>
      <form
        id={formId}
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) =>
          onSubmit({ ...values, weightage: Number(values.weightage) }),
        )}
      >
        <TextAreaField
          name="description"
          label={t("form.description")}
          description={t("form.descriptionHelp")}
          rows={2}
          disabled={submitting}
        />

        <TextField
          name="weightage"
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step={0.01}
          label={t("form.weightage")}
          description={t("form.weightageHelp")}
          disabled={submitting}
          className="w-32"
        />

        <fieldset className="flex flex-col gap-4 border-t border-border pt-4" disabled={submitting}>
          <legend className="text-sm font-semibold text-foreground">{t("levelsTitle")}</legend>
          <p className="text-xs text-muted-foreground">{t("formNote")}</p>
          {KPI_LEVEL_FIELDS.map((level) => (
            <TextAreaField
              key={level.field}
              name={level.field}
              label={t(`level.${level.field}`)}
              badge={<Badge variant="outline">{t("levelValue", { value: level.value })}</Badge>}
              description={t("form.levelHelp")}
              rows={2}
            />
          ))}
        </fieldset>
      </form>
    </Form>
  );
}
