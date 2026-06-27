"use client";

import * as React from "react";
import {
  useForm,
  useFieldArray,
  useWatch,
  Controller,
  type Control,
  type UseFormRegister,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations, useLocale } from "next-intl";
import {
  Sparkles,
  Loader2,
  Plus,
  Trash2,
  Info,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Save,
  CheckCircle2,
} from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { IPIP_FACETS } from "@/lib/ipip-facets";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { FacetPicker } from "./FacetPicker";

const FACET_SET = new Set(IPIP_FACETS);

// Re-validate at the form boundary, mirroring lib/validations/roleProfile so a
// row the API would 400 on is caught inline first.
const competencySchema = z.object({
  name: z.string().trim().min(2).max(120),
  facets: z
    .array(z.string())
    .min(1)
    .max(8)
    .refine((fs) => fs.every((f) => FACET_SET.has(f)), { message: "invalidFacet" }),
  direction: z.enum(["HIGH", "MODERATE", "LOW"]),
  targetPercentile: z.coerce.number().int().min(1).max(99),
  weight: z.coerce.number().positive().max(100),
  onetRef: z.string().trim().max(120).optional().or(z.literal("")),
  sourceCitation: z.string().trim().max(500).optional().or(z.literal("")),
});

const sjtOptionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  text_en: z.string().trim().min(1).max(2000),
});

const sjtSchema = z.object({
  scenario_en: z.string().trim().min(4).max(4000),
  options: z.array(sjtOptionSchema).min(2).max(8),
  bestOptionId: z.string().min(1),
  worstOptionId: z.string().optional().or(z.literal("")),
});

const formSchema = z.object({
  roleFamilyId: z.string().min(1),
  title: z.string().trim().min(2).max(160),
  jdSourceText: z.string().trim().max(20000).optional().or(z.literal("")),
  competencies: z.array(competencySchema),
  sjtItems: z.array(sjtSchema),
});

type FormValues = z.infer<typeof formSchema>;

export type RoleFamilyOption = { id: string; key: string; name: string };

export type WizardInitial = {
  id: string;
  roleFamilyId: string;
  title: string;
  jdSourceText: string;
  isAiDrafted: boolean;
  competencies: FormValues["competencies"];
  sjtItems: FormValues["sjtItems"];
};

const DIRECTIONS = ["HIGH", "MODERATE", "LOW"] as const;

function emptyCompetency(): FormValues["competencies"][number] {
  return {
    name: "",
    facets: [],
    direction: "HIGH",
    targetPercentile: 50,
    weight: 1,
    onetRef: "",
    sourceCitation: "",
  };
}

type StepId = 1 | 2 | 3 | 4 | 5;

export function RoleProfileWizard({
  families,
  initial,
}: {
  families: RoleFamilyOption[];
  /** Present in edit mode (existing DRAFT/IN_REVIEW); absent when creating new. */
  initial?: WizardInitial;
}) {
  const t = useTranslations("roleProfiles");
  const tDir = useTranslations("roleProfiles.directions");
  const locale = useLocale();
  const router = useRouter();
  const isEdit = Boolean(initial);

  const [step, setStep] = React.useState<StepId>(isEdit ? 3 : 1);
  const [draftState, setDraftState] = React.useState<
    "idle" | "loading" | "unconfigured" | "failed"
  >("idle");
  const [manualRevealed, setManualRevealed] = React.useState(isEdit);
  const [aiBanner, setAiBanner] = React.useState(false);
  const [submitState, setSubmitState] = React.useState<
    "idle" | "saving" | "approving"
  >("idle");
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    getValues,
    setValue,
    trigger,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: initial
      ? {
          roleFamilyId: initial.roleFamilyId,
          title: initial.title,
          jdSourceText: initial.jdSourceText,
          competencies: initial.competencies,
          sjtItems: initial.sjtItems,
        }
      : {
          roleFamilyId: "",
          title: "",
          jdSourceText: "",
          competencies: [],
          sjtItems: [],
        },
  });

  const comps = useFieldArray({ control, name: "competencies" });
  const sjts = useFieldArray({ control, name: "sjtItems" });

  // ---- Step 2: AI draft ----------------------------------------------------
  async function draftWithAi() {
    setSubmitError(null);
    const ok = await trigger(["roleFamilyId", "title", "jdSourceText"]);
    if (!ok) {
      setStep(1);
      return;
    }
    const { roleFamilyId, title, jdSourceText } = getValues();
    const family = families.find((f) => f.id === roleFamilyId);
    if (!family || !jdSourceText || jdSourceText.trim().length < 40) {
      // JD too short for the API contract — guide the user, don't call.
      setDraftState("unconfigured");
      setManualRevealed(true);
      return;
    }

    setDraftState("loading");
    try {
      const res = await fetch("/api/role-profiles/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleFamilyKey: family.key,
          roleTitle: title,
          jdSourceText,
        }),
      });

      if (res.status === 503) {
        setDraftState("unconfigured");
        setManualRevealed(true);
        return;
      }
      if (!res.ok) {
        setDraftState("failed");
        setManualRevealed(true);
        return;
      }

      const body = (await res.json()) as {
        data?: { competencies?: unknown[] };
      };
      const drafted = (body.data?.competencies ?? []) as Array<{
        name: string;
        facets?: string[];
        direction?: "HIGH" | "MODERATE" | "LOW";
        targetPercentile?: number;
        weight?: number;
        onetRef?: string | null;
        sourceCitation?: string | null;
      }>;

      setValue(
        "competencies",
        drafted.map((c) => ({
          name: c.name ?? "",
          facets: (c.facets ?? []).filter((f) => FACET_SET.has(f)),
          direction: c.direction ?? "HIGH",
          targetPercentile: c.targetPercentile ?? 50,
          weight: c.weight ?? 1,
          onetRef: c.onetRef ?? "",
          sourceCitation: c.sourceCitation ?? "",
        })),
        { shouldValidate: false }
      );
      setDraftState("idle");
      setAiBanner(true);
      setManualRevealed(true);
      setStep(3);
    } catch {
      setDraftState("failed");
      setManualRevealed(true);
    }
  }

  // ---- Save / Approve ------------------------------------------------------
  function toApiPayload(values: FormValues) {
    return {
      roleFamilyId: values.roleFamilyId,
      title: values.title,
      jdSourceText: values.jdSourceText?.trim() || undefined,
      isAiDrafted: aiBanner || initial?.isAiDrafted || false,
      competencies: values.competencies.map((c) => ({
        name: c.name,
        facets: c.facets,
        direction: c.direction,
        targetPercentile: Number(c.targetPercentile),
        weight: Number(c.weight),
        onetRef: c.onetRef?.trim() || undefined,
        sourceCitation: c.sourceCitation?.trim() || undefined,
      })),
      sjtItems: values.sjtItems.map((s) => ({
        scenario_en: s.scenario_en,
        options: s.options.map((o) => ({ id: o.id, text_en: o.text_en })),
        scoringKey: {
          bestOptionId: s.bestOptionId,
          worstOptionId: s.worstOptionId?.trim() || undefined,
        },
      })),
    };
  }

  /** Persist (create new or PUT existing). Returns the profile id or null on error. */
  async function persist(values: FormValues): Promise<string | null> {
    const payload = toApiPayload(values);
    const res = isEdit
      ? await fetch(`/api/role-profiles/${initial!.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: payload.title,
            competencies: payload.competencies,
            sjtItems: payload.sjtItems,
          }),
        })
      : await fetch("/api/role-profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

    const body = (await res.json().catch(() => ({}))) as {
      data?: { id: string };
      error?: string;
    };
    if (!res.ok) {
      setSubmitError(body.error ?? t("saveError"));
      return null;
    }
    return isEdit ? initial!.id : (body.data?.id ?? null);
  }

  async function onSaveDraft(values: FormValues) {
    setSubmitError(null);
    setSubmitState("saving");
    const id = await persist(values);
    if (!id) {
      setSubmitState("idle");
      return;
    }
    router.push(`/app/roles/${id}`, { locale });
  }

  async function onApprove(values: FormValues) {
    setSubmitError(null);
    if (values.competencies.length === 0) {
      setSubmitError(t("approveNeedsCompetency"));
      return;
    }
    setSubmitState("approving");
    const id = await persist(values);
    if (!id) {
      setSubmitState("idle");
      return;
    }
    const res = await fetch(`/api/role-profiles/${id}/approve`, {
      method: "POST",
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      // Draft was saved; only the activation failed — say so honestly.
      setSubmitError(body.error ?? t("approveError"));
      setSubmitState("idle");
      router.push(`/app/roles/${id}`, { locale });
      return;
    }
    router.push(`/app/roles/${id}`, { locale });
  }

  // ---- Step navigation -----------------------------------------------------
  const STEPS: { id: StepId; key: string }[] = [
    { id: 1, key: "stepDefine" },
    { id: 2, key: "stepAi" },
    { id: 3, key: "stepCompetencies" },
    { id: 4, key: "stepSjt" },
    { id: 5, key: "stepReview" },
  ];
  const visibleSteps = isEdit ? STEPS.filter((s) => s.id !== 2) : STEPS;

  async function goNext() {
    if (step === 1) {
      const ok = await trigger(["roleFamilyId", "title", "jdSourceText"]);
      if (!ok) return;
      setStep(isEdit ? 3 : 2);
      return;
    }
    if (step === 3) {
      const ok = await trigger("competencies");
      if (!ok) return;
    }
    setStep((s) => Math.min(5, (s + 1) as StepId) as StepId);
  }
  function goBack() {
    setStep((s) => {
      const prev = (s - 1) as StepId;
      if (isEdit && prev === 2) return 1;
      return Math.max(isEdit ? 3 : 1, prev) as StepId;
    });
  }

  const values = useWatch({ control }) as FormValues;
  const submitting = submitState !== "idle";

  return (
    <div className="flex flex-col gap-6">
      {/* Stepper */}
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
        {visibleSteps.map((s, i) => {
          const active = s.id === step;
          const done = s.id < step;
          return (
            <li key={s.id} className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                  active
                    ? "bg-primary text-primary-foreground"
                    : done
                      ? "bg-accent/15 text-accent"
                      : "bg-secondary text-muted-foreground"
                )}
                aria-current={active ? "step" : undefined}
              >
                {i + 1}
              </span>
              <span
                className={cn(
                  active ? "font-medium text-foreground" : "text-muted-foreground"
                )}
              >
                {t(s.key)}
              </span>
              {i < visibleSteps.length - 1 && (
                <ChevronRight className="size-4 text-muted-foreground rtl:rotate-180" />
              )}
            </li>
          );
        })}
      </ol>

      {/* STEP 1: Define */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("stepDefine")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="roleFamilyId">{t("fieldFamily")}</Label>
              <Select
                id="roleFamilyId"
                aria-invalid={!!errors.roleFamilyId}
                {...register("roleFamilyId")}
              >
                <option value="">{t("familyPlaceholder")}</option>
                {families.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
              {errors.roleFamilyId && (
                <FieldError msg={t("familyRequired")} />
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="title">{t("fieldTitle")}</Label>
              <Input
                id="title"
                aria-invalid={!!errors.title}
                {...register("title")}
              />
              {errors.title && <FieldError msg={t("titleRequired")} />}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jdSourceText">{t("fieldJd")}</Label>
              <Textarea
                id="jdSourceText"
                rows={6}
                placeholder={t("jdPlaceholder")}
                {...register("jdSourceText")}
              />
              <p className="text-xs text-muted-foreground">{t("jdHint")}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 2: AI draft */}
      {step === 2 && !isEdit && (
        <Card>
          <CardHeader>
            <CardTitle>{t("stepAi")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t("aiIntro")}</p>

            {draftState === "unconfigured" && (
              <Notice
                tone="info"
                icon={Info}
                text={t("aiUnconfigured")}
              />
            )}
            {draftState === "failed" && (
              <Notice
                tone="warning"
                icon={AlertTriangle}
                text={t("aiFailed")}
              />
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={draftWithAi}
                disabled={draftState === "loading"}
              >
                {draftState === "loading" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {draftState === "loading"
                  ? t("aiDrafting")
                  : draftState === "failed"
                    ? t("aiRetry")
                    : t("aiDraftBtn")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setManualRevealed(true);
                  setStep(3);
                }}
                disabled={draftState === "loading"}
              >
                {t("aiManual")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 3: Competencies */}
      {step === 3 && (manualRevealed || comps.fields.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>{t("stepCompetencies")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {aiBanner && (
              <Notice tone="info" icon={Sparkles} text={t("aiBanner")} />
            )}

            {comps.fields.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                {t("noCompetencies")}
              </p>
            ) : (
              <ul className="flex flex-col gap-4">
                {comps.fields.map((field, idx) => (
                  <li
                    key={field.id}
                    className="rounded-md border border-border p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground tabular-nums">
                        {t("competencyN", { n: idx + 1 })}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => comps.remove(idx)}
                        aria-label={t("removeRow")}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5 sm:col-span-2">
                        <Label htmlFor={`comp-${idx}-name`}>
                          {t("fieldCompName")}
                        </Label>
                        <Input
                          id={`comp-${idx}-name`}
                          aria-invalid={!!errors.competencies?.[idx]?.name}
                          {...register(`competencies.${idx}.name` as const)}
                        />
                        {errors.competencies?.[idx]?.name && (
                          <FieldError msg={t("compNameRequired")} />
                        )}
                      </div>

                      <div className="flex flex-col gap-1.5 sm:col-span-2">
                        <Label id={`comp-${idx}-facets-label`}>
                          {t("fieldFacets")}
                        </Label>
                        <Controller
                          control={control}
                          name={`competencies.${idx}.facets` as const}
                          render={({ field: f }) => (
                            <FacetPicker
                              value={f.value}
                              onChange={f.onChange}
                              labelId={`comp-${idx}-facets-label`}
                              invalid={!!errors.competencies?.[idx]?.facets}
                            />
                          )}
                        />
                        {errors.competencies?.[idx]?.facets && (
                          <FieldError msg={t("facetsRequired")} />
                        )}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`comp-${idx}-dir`}>
                          {t("fieldDirection")}
                        </Label>
                        <Select
                          id={`comp-${idx}-dir`}
                          {...register(
                            `competencies.${idx}.direction` as const
                          )}
                        >
                          {DIRECTIONS.map((d) => (
                            <option key={d} value={d}>
                              {tDir(d)}
                            </option>
                          ))}
                        </Select>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`comp-${idx}-pct`}>
                          {t("fieldTargetPercentile")}
                        </Label>
                        <Input
                          id={`comp-${idx}-pct`}
                          type="number"
                          min={1}
                          max={99}
                          className="tabular-nums"
                          aria-invalid={
                            !!errors.competencies?.[idx]?.targetPercentile
                          }
                          {...register(
                            `competencies.${idx}.targetPercentile` as const
                          )}
                        />
                        {errors.competencies?.[idx]?.targetPercentile && (
                          <FieldError msg={t("percentileRange")} />
                        )}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`comp-${idx}-weight`}>
                          {t("fieldWeight")}
                        </Label>
                        <Input
                          id={`comp-${idx}-weight`}
                          type="number"
                          step="0.1"
                          min={0.1}
                          max={100}
                          className="tabular-nums"
                          aria-invalid={!!errors.competencies?.[idx]?.weight}
                          {...register(`competencies.${idx}.weight` as const)}
                        />
                        {errors.competencies?.[idx]?.weight && (
                          <FieldError msg={t("weightPositive")} />
                        )}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`comp-${idx}-onet`}>
                          {t("fieldOnet")}
                        </Label>
                        <Input
                          id={`comp-${idx}-onet`}
                          {...register(`competencies.${idx}.onetRef` as const)}
                        />
                      </div>

                      <div className="flex flex-col gap-1.5 sm:col-span-2">
                        <Label htmlFor={`comp-${idx}-cite`}>
                          {t("fieldCitation")}
                        </Label>
                        <Input
                          id={`comp-${idx}-cite`}
                          placeholder={t("citationPlaceholder")}
                          {...register(
                            `competencies.${idx}.sourceCitation` as const
                          )}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() => comps.append(emptyCompetency())}
              >
                <Plus className="size-4" />
                {t("addCompetency")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 4: SJT items (minimal) */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("stepSjt")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t("sjtIntro")}</p>

            {sjts.fields.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                {t("noSjt")}
              </p>
            ) : (
              <ul className="flex flex-col gap-4">
                {sjts.fields.map((field, idx) => (
                  <SjtItemEditor
                    key={field.id}
                    idx={idx}
                    control={control}
                    register={register}
                    onRemove={() => sjts.remove(idx)}
                  />
                ))}
              </ul>
            )}

            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  sjts.append({
                    scenario_en: "",
                    options: [
                      { id: "a", text_en: "" },
                      { id: "b", text_en: "" },
                    ],
                    bestOptionId: "a",
                    worstOptionId: "",
                  })
                }
              >
                <Plus className="size-4" />
                {t("addSjt")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 5: Review & approve */}
      {step === 5 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("stepReview")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <ReviewRow
                label={t("fieldFamily")}
                value={
                  families.find((f) => f.id === values.roleFamilyId)?.name ?? "—"
                }
              />
              <ReviewRow label={t("fieldTitle")} value={values.title || "—"} />
            </dl>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">
                {t("reviewCompetencies", { count: values.competencies.length })}
              </h3>
              {values.competencies.length === 0 ? (
                <Notice
                  tone="warning"
                  icon={AlertTriangle}
                  text={t("approveNeedsCompetency")}
                />
              ) : (
                <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                  {values.competencies.map((c, i) => (
                    <li key={i} className="flex flex-col gap-1 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">
                          {c.name || t("untitled")}
                        </span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                          <Badge variant="outline">{tDir(c.direction)}</Badge>
                          {t("pctShort", { pct: c.targetPercentile })}
                        </span>
                      </div>
                      {c.sourceCitation ? (
                        <p className="text-xs text-muted-foreground">
                          {t("citationLabel")}: {c.sourceCitation}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {t("noCitation")}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {submitError && (
              <Notice tone="warning" icon={AlertTriangle} text={submitError} />
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleSubmit(onSaveDraft)}
                disabled={submitting}
              >
                {submitState === "saving" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {t("saveDraft")}
              </Button>
              <Button
                type="button"
                onClick={handleSubmit(onApprove)}
                disabled={submitting || values.competencies.length === 0}
              >
                {submitState === "approving" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                {t("approveActivate")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Footer nav */}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={goBack}
          disabled={step === (isEdit ? 3 : 1) || submitting}
        >
          <ChevronLeft className="size-4 rtl:rotate-180" />
          {t("back")}
        </Button>
        {step < 5 && (
          <Button type="button" onClick={goNext} disabled={submitting}>
            {t("next")}
            <ChevronRight className="size-4 rtl:rotate-180" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ---- small presentational helpers -----------------------------------------

function FieldError({ msg }: { msg: string }) {
  return (
    <p role="alert" className="text-xs text-[var(--signal-below)]">
      {msg}
    </p>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

function Notice({
  tone,
  icon: Icon,
  text,
}: {
  tone: "info" | "warning";
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm",
        tone === "info"
          ? "border-accent/30 bg-accent/5 text-foreground"
          : "border-[var(--signal-partial)]/30 bg-[var(--signal-partial)]/5 text-foreground"
      )}
      role={tone === "warning" ? "alert" : "status"}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "info" ? "text-accent" : "text-[var(--signal-partial)]"
        )}
      />
      <span>{text}</span>
    </div>
  );
}

// ---- SJT sub-editor (nested options field array) --------------------------

function SjtItemEditor({
  idx,
  control,
  register,
  onRemove,
}: {
  idx: number;
  control: Control<FormValues>;
  register: UseFormRegister<FormValues>;
  onRemove: () => void;
}) {
  const t = useTranslations("roleProfiles");
  const options = useFieldArray({
    control,
    name: `sjtItems.${idx}.options` as const,
  });

  return (
    <li className="rounded-md border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          {t("sjtN", { n: idx + 1 })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={t("removeRow")}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`sjt-${idx}-scenario`}>{t("fieldScenario")}</Label>
          <Textarea
            id={`sjt-${idx}-scenario`}
            rows={3}
            {...register(`sjtItems.${idx}.scenario_en` as const)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t("fieldOptions")}</Label>
          {options.fields.map((opt, oIdx) => (
            <div key={opt.id} className="flex items-center gap-2">
              <Input
                aria-label={t("optionId")}
                className="w-16 text-center"
                {...register(
                  `sjtItems.${idx}.options.${oIdx}.id` as const
                )}
              />
              <Input
                aria-label={t("optionText")}
                placeholder={t("optionTextPlaceholder")}
                {...register(
                  `sjtItems.${idx}.options.${oIdx}.text_en` as const
                )}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => options.remove(oIdx)}
                disabled={options.fields.length <= 2}
                aria-label={t("removeOption")}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                options.append({
                  id: String.fromCharCode(97 + options.fields.length),
                  text_en: "",
                })
              }
              disabled={options.fields.length >= 8}
            >
              <Plus className="size-4" />
              {t("addOption")}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`sjt-${idx}-best`}>{t("fieldBest")}</Label>
            <Input
              id={`sjt-${idx}-best`}
              aria-label={t("fieldBest")}
              {...register(`sjtItems.${idx}.bestOptionId` as const)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`sjt-${idx}-worst`}>{t("fieldWorst")}</Label>
            <Input
              id={`sjt-${idx}-worst`}
              {...register(`sjtItems.${idx}.worstOptionId` as const)}
            />
          </div>
        </div>
      </div>
    </li>
  );
}
