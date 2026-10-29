"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { CURRENCY_CODES } from "@/lib/hiring/money";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { Field, Textarea } from "@/components/shared/FormControls";
import { useOrgOptions } from "../ui/org";
import { PersonPicker, type Person } from "../ui/person-picker";
import { Notice, QueryState } from "../ui/states";
import { VacantStepsNotice, vacantRoles } from "../ui/vacant-steps";
import { ApprovalRoutePreview, useRequestRoute } from "./ApprovalRoutePreview";
import { NeedContext } from "./NeedContext";

/**
 * Step 1 — the hiring request (Interview Hub `HiringRequestForm`, artboards
 * HiringRequest / T01 / T21). Save a draft, or submit for headcount approval
 * with a required note. Every rule is enforced again at the API.
 */
type Need = {
  id: string;
  entityId: string;
  departmentId: string;
  department: string | null;
  status: string;
};

export function HiringRequestForm() {
  const t = useTranslations("hiring.request");
  const router = useRouter();
  const locale = useLocale();
  const needId = useSearchParams().get("need");
  const org = useOrgOptions();
  const need = useHiringQuery<Need>(needId ? `/api/hiring/needs/${needId}` : null);
  const [form, setForm] = useState({
    title: "",
    entityId: "",
    departmentId: "",
    openings: "1",
    targetCloseDate: "",
    salaryCurrency: "OMR",
    salaryBandMin: "",
    salaryBandMax: "",
    businessNeed: "",
    alternativesConsidered: "",
    note: "",
  });
  const [manager, setManager] = useState<Person | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const entityId = need.data?.entityId ?? form.entityId;
  const departmentId = need.data?.departmentId ?? form.departmentId;

  const save = useHiringMutation<object, { id: string }>("POST", "/api/hiring/requests", {
    onSuccess: (r) => router.push(`/${locale}/hiring/requisitions/${r.id}`),
  });
  const num = (v: string) => (v === "" ? null : Number(v));
  const request = {
    title: form.title,
    entityId,
    departmentId: departmentId || null,
    hiringManagerId: manager?.id ?? null,
    openings: num(form.openings),
    targetCloseDate: form.targetCloseDate || null,
    salaryCurrency: form.salaryCurrency,
    salaryBandMin: num(form.salaryBandMin),
    salaryBandMax: num(form.salaryBandMax),
    businessNeed: form.businessNeed || null,
    alternativesConsidered: form.alternativesConsidered || null,
    departmentNeedId: needId,
  };

  return (
    <QueryState isLoading={org.isLoading || need.isLoading} error={org.error ?? need.error}>
      <div className="space-y-4">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        {need.data ? <NeedContext needId={need.data.id} /> : null}
        <SectionCard title={t("requirement")}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("jobTitle")} htmlFor="hr-title" required>
              <Input
                id="hr-title"
                value={form.title}
                onChange={(e) => set("title")(e.target.value)}
              />
            </Field>
            <Field label={t("entity")} htmlFor="hr-entity" required>
              <NativeSelect
                id="hr-entity"
                value={entityId}
                disabled={Boolean(need.data)}
                onChange={(e) =>
                  setForm((f) => ({ ...f, entityId: e.target.value, departmentId: "" }))
                }
              >
                <option value="">{t("choose")}</option>
                {(org.data?.entities ?? [])
                  .filter((e) => org.data?.manageableEntityIds.includes(e.id))
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Field label={t("department")} htmlFor="hr-dept" required>
              <NativeSelect
                id="hr-dept"
                value={departmentId}
                disabled={!entityId || Boolean(need.data)}
                onChange={(e) => set("departmentId")(e.target.value)}
              >
                <option value="">{t("choose")}</option>
                {org.departmentsOf(entityId).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("hiringManager")} htmlFor="hr-hm" required>
              <PersonPicker id="hr-hm" value={manager} onChange={setManager} />
            </Field>
            <Field label={t("openings")} htmlFor="hr-openings" required hint={t("openingsHint")}>
              <Input
                id="hr-openings"
                type="number"
                min={1}
                max={999}
                value={form.openings}
                onChange={(e) => set("openings")(e.target.value)}
              />
            </Field>
            <Field label={t("targetClose")} htmlFor="hr-close" required>
              <Input
                id="hr-close"
                type="date"
                value={form.targetCloseDate}
                onChange={(e) => set("targetCloseDate")(e.target.value)}
              />
            </Field>
            <Field label={t("currency")} htmlFor="hr-cur">
              <NativeSelect
                id="hr-cur"
                value={form.salaryCurrency}
                onChange={(e) => set("salaryCurrency")(e.target.value)}
              >
                {CURRENCY_CODES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("bandMin")} htmlFor="hr-min" required>
                <Input
                  id="hr-min"
                  type="number"
                  min={0}
                  value={form.salaryBandMin}
                  onChange={(e) => set("salaryBandMin")(e.target.value)}
                />
              </Field>
              <Field label={t("bandMax")} htmlFor="hr-max" required>
                <Input
                  id="hr-max"
                  type="number"
                  min={0}
                  value={form.salaryBandMax}
                  onChange={(e) => set("salaryBandMax")(e.target.value)}
                />
              </Field>
            </div>
            <Field label={t("businessNeed")} htmlFor="hr-need" required className="md:col-span-2">
              <Textarea
                id="hr-need"
                value={form.businessNeed}
                onChange={(e) => set("businessNeed")(e.target.value)}
              />
            </Field>
            <Field label={t("alternatives")} htmlFor="hr-alt" required className="md:col-span-2">
              <Textarea
                id="hr-alt"
                value={form.alternativesConsidered}
                onChange={(e) => set("alternativesConsidered")(e.target.value)}
              />
            </Field>
          </div>
        </SectionCard>
        {entityId ? (
          <ApprovalRoutePreview
            entityId={entityId}
            departmentId={departmentId}
            bandMax={form.salaryBandMax}
            currency={form.salaryCurrency}
          />
        ) : null}
        <SectionCard title={t("noteTitle")} subtitle={t("noteHint")}>
          <Field label={t("note")} htmlFor="hr-note">
            <Textarea
              id="hr-note"
              value={form.note}
              onChange={(e) => set("note")(e.target.value)}
            />
          </Field>
          <SubmitControls
            route={
              entityId
                ? {
                    entityId,
                    departmentId,
                    bandMax: form.salaryBandMax,
                    currency: form.salaryCurrency,
                  }
                : null
            }
            error={save.error?.message ?? null}
            pending={save.isPending}
            canDraft={Boolean(form.title && entityId)}
            canSubmit={Boolean(form.note.trim() && entityId)}
            onDraft={() => save.mutate({ mode: "draft", request })}
            onSubmit={() => save.mutate({ mode: "submit", request, note: form.note })}
          />
        </SectionCard>
      </div>
    </QueryState>
  );
}

/**
 * Save / submit, with the dead-end check (docs/blueprints/ux-p0.md, AC-3.2):
 * reads the same cached route as the preview above, and will not submit into
 * a step nobody holds. The server refuses it too.
 */
function SubmitControls(props: {
  route: Parameters<typeof useRequestRoute>[0];
  error: string | null;
  pending: boolean;
  canDraft: boolean;
  canSubmit: boolean;
  onDraft: () => void;
  onSubmit: () => void;
}) {
  const t = useTranslations("hiring.request");
  const route = useRequestRoute(props.route);
  const vacant = route.data ? vacantRoles(route.data.steps) : [];
  return (
    <>
      {vacant.length ? (
        <div className="mt-3">
          <VacantStepsNotice roles={vacant} />
        </div>
      ) : null}
      {props.error ? (
        <div className="mt-3">
          <Notice tone="danger">{props.error}</Notice>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          disabled={props.pending || !props.canDraft}
          onClick={props.onDraft}
        >
          {t("saveDraft")}
        </Button>
        <Button
          disabled={props.pending || !props.canSubmit || vacant.length > 0}
          onClick={props.onSubmit}
        >
          {t("submit")}
        </Button>
      </div>
    </>
  );
}
