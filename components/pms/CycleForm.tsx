"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { Form, TextField, useZodForm } from "@/components/shared/FormField";
import { STAGE_ORDER, type CycleStage, type CycleStageKind } from "@/components/pms/CycleList";
import { endOfDay, startOfDay, toDateInput } from "@/lib/date-input";

/**
 * The cycle form — spec §2 ("HR sets deadlines for each stage") and §5.4/§5.5.
 *
 * One component serves both writes because they are the same three touchpoints:
 *   - `create` → POST /api/cycles (a year plus all three stages, which the route
 *     refuses to accept partially — a half-configured year is not a year).
 *   - `edit`   → PUT /api/cycles/[id]/stages (moving deadlines; on an OPEN cycle
 *     that is §5.5's extension, which is why the caller labels it as one).
 *
 * WHY THE FORM IS ALL STRINGS. The API schema (lib/validations/cycle.ts) takes
 * coerced `Date`s and numbers. An HTML date input speaks "YYYY-MM-DD" and a
 * number input speaks text, so this schema mirrors the API contract in the
 * input's own vocabulary and converts once, at submit. The alternative —
 * binding the coercing schema straight to the form — turns an empty grace field
 * into a silent 0 (`Number("") === 0`), which is a real answer to a question the
 * user never answered.
 *
 * WHAT TIME A DEADLINE LANDS AT. HR picks a DAY; the day has to become an
 * instant, because §5.4 locks the stage the moment the deadline passes. A stage
 * opens at 00:00 and its deadline lands at 23:59:59 on the chosen day, in the
 * browser's timezone — so "the deadline is the 31st" means the whole of the
 * 31st. The form says this out loud under each field rather than leaving HR to
 * discover it when a stage locks a day early.
 */

const DATE_INPUT = /^\d{4}-\d{2}-\d{2}$/;

interface CycleStageSubmitValues {
  kind: CycleStageKind;
  /** ISO instant. */
  opensAt: string;
  /** ISO instant, at 23:59:59 local on the chosen day. */
  deadline: string;
  graceDays: number;
}

export interface CycleFormSubmitValues {
  year: number;
  stages: CycleStageSubmitValues[];
}

interface CycleFormProps {
  /** Ties the dialog footer's submit button to this form (`form="…"`). */
  formId: string;
  mode: "create" | "edit";
  /** Prefilled year for `create`; the cycle's own year is fixed on `edit`. */
  defaultYear?: number;
  /** Existing stages, when editing. */
  initialStages?: CycleStage[];
  submitting?: boolean;
  onSubmit: (values: CycleFormSubmitValues) => void;
}

export function CycleForm({
  formId,
  mode,
  defaultYear,
  initialStages,
  submitting,
  onSubmit,
}: CycleFormProps) {
  const t = useTranslations("pms");

  const schema = useMemo(() => {
    const stage = z
      .object({
        opensAt: z.string().regex(DATE_INPUT, { message: t("cycles.validation.dateRequired") }),
        deadline: z.string().regex(DATE_INPUT, { message: t("cycles.validation.dateRequired") }),
        graceDays: z.string().refine(
          (v) => /^\d{1,2}$/.test(v) && Number(v) <= 30,
          // Bounded at 30 for the same reason the API is: a typo of 30 for 3 on a
          // December deadline parks the intervention past the cycle boundary.
          { message: t("cycles.validation.graceRange") },
        ),
      })
      // Same-day is legal: the stage opens at 00:00 and locks at 23:59.
      .refine((s) => s.deadline >= s.opensAt, {
        message: t("cycles.validation.deadlineBeforeOpens"),
        path: ["deadline"],
      });

    return z.object({
      year: z.string().refine((v) => /^\d{4}$/.test(v) && Number(v) >= 2000 && Number(v) <= 2100, {
        message: t("cycles.validation.year"),
      }),
      stages: z.object({
        GOAL_SETTING: stage,
        MID_YEAR: stage,
        YEAR_END: stage,
      }),
    });
  }, [t]);

  const form = useZodForm(schema, {
    defaultValues: {
      year: String(defaultYear ?? new Date().getFullYear()),
      stages: Object.fromEntries(
        STAGE_ORDER.map((kind) => {
          const existing = initialStages?.find((s) => s.kind === kind);
          return [
            kind,
            {
              opensAt: existing ? toDateInput(existing.opensAt) : "",
              deadline: existing ? toDateInput(existing.deadline) : "",
              graceDays: String(existing?.graceDays ?? 3),
            },
          ];
        }),
      ) as Record<CycleStageKind, { opensAt: string; deadline: string; graceDays: string }>,
    },
  });

  return (
    <Form {...form}>
      <form
        id={formId}
        onSubmit={form.handleSubmit((values) =>
          onSubmit({
            year: Number(values.year),
            stages: STAGE_ORDER.map((kind) => ({
              kind,
              opensAt: startOfDay(values.stages[kind].opensAt),
              deadline: endOfDay(values.stages[kind].deadline),
              graceDays: Number(values.stages[kind].graceDays),
            })),
          }),
        )}
        className="flex flex-col gap-6"
      >
        {mode === "create" ? (
          <TextField
            name="year"
            type="number"
            inputMode="numeric"
            min={2000}
            max={2100}
            label={t("cycles.form.year")}
            description={t("cycles.form.yearHelp")}
            disabled={submitting}
            className="w-32"
          />
        ) : null}

        {STAGE_ORDER.map((kind, index) => (
          <fieldset
            key={kind}
            // A rule, not a nested card: a card inside the dialog's own surface
            // is the "card soup" tell the design rubric bans.
            className={
              index === 0
                ? "flex flex-col gap-3"
                : "flex flex-col gap-3 border-t border-border pt-6"
            }
            disabled={submitting}
          >
            <legend className="text-sm font-semibold text-foreground">
              {t(`cycles.stage.${kind}`)}
            </legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField
                name={`stages.${kind}.opensAt`}
                type="date"
                label={t("cycles.form.opensAt")}
                description={t("cycles.form.opensHelp")}
              />
              <TextField
                name={`stages.${kind}.deadline`}
                type="date"
                label={t("cycles.form.deadline")}
                description={t("cycles.form.deadlineHelp")}
              />
              <TextField
                name={`stages.${kind}.graceDays`}
                type="number"
                inputMode="numeric"
                min={0}
                max={30}
                label={t("cycles.form.graceDays")}
                description={t("cycles.form.graceHelp")}
              />
            </div>
          </fieldset>
        ))}
      </form>
    </Form>
  );
}
