"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { JdFileButtons } from "../ai/JdFileButtons";
import { CompetencyPicker } from "../ui/competency-picker";
import { Field, Textarea } from "../ui/fields";
import { useOrgOptions } from "../ui/org";
import { PersonPicker, type Person } from "../ui/person-picker";
import { Notice, QueryState } from "../ui/states";
import { CompSection } from "./RequisitionCompSection";

/**
 * The JD-template-driven requisition form (Interview Hub `PositionForm`,
 * `/positions/new` and `/positions/[id]/edit`). Picking a catalogued role
 * pre-fills the JD, competencies and grade. After DRAFT the server freezes the
 * title, JD and openings; the form says so instead of failing late.
 */
type Template = {
  id: string;
  title: string;
  description: string;
  competencies: string[];
  grade: string | null;
};
type Detail = {
  id: string;
  status: string;
  title: string;
  entityId: string;
  departmentId: string | null;
  description: string;
  competencies: string[];
  grade: string | null;
  jdTemplateTitle: string | null;
  openings: number;
  salaryCurrency: string;
  salaryBandMin: number | null;
  salaryBandMax: number | null;
  bandHidden: boolean;
  targetCloseDate: string | null;
  businessNeed: string | null;
  alternativesConsidered: string | null;
  hmSeesSalary: boolean;
  hiringManager: Person | null;
  owner: Person | null;
};

const EMPTY = {
  title: "",
  entityId: "",
  departmentId: "",
  description: "",
  grade: "",
  jdTemplateTitle: "",
  openings: "1",
  salaryCurrency: "OMR",
  salaryBandMin: "",
  salaryBandMax: "",
  targetCloseDate: "",
  businessNeed: "",
  alternativesConsidered: "",
};

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function seedFrom(d: Detail | undefined) {
  return {
    form: initialFrom(d),
    competencies: d?.competencies ?? [],
    manager: d?.hiringManager ?? null,
    owner: d?.owner ?? null,
    hmSeesSalary: d?.hmSeesSalary ?? false,
    bandHidden: d?.bandHidden ?? false,
  };
}

function initialFrom(d: Detail | undefined): typeof EMPTY {
  if (!d) return EMPTY;
  const s = str;
  return {
    title: d.title,
    entityId: d.entityId,
    departmentId: s(d.departmentId),
    description: d.description,
    grade: s(d.grade),
    jdTemplateTitle: s(d.jdTemplateTitle),
    openings: s(d.openings),
    salaryCurrency: d.salaryCurrency,
    salaryBandMin: s(d.salaryBandMin),
    salaryBandMax: s(d.salaryBandMax),
    targetCloseDate: d.targetCloseDate ? d.targetCloseDate.slice(0, 10) : "",
    businessNeed: s(d.businessNeed),
    alternativesConsidered: s(d.alternativesConsidered),
  };
}

/** The PUT/POST body; locked fields and a hidden band are never sent (the server would refuse them). */
function requestBody(
  f: typeof EMPTY,
  x: {
    locked: boolean;
    bandHidden: boolean;
    competencies: string[];
    manager: Person | null;
    owner: Person | null;
    hmSeesSalary: boolean;
  },
) {
  const num = (v: string) => (v === "" ? undefined : Number(v));
  const orNull = (v: string) => v || null;
  return {
    ...(x.locked ? {} : { title: f.title, openings: num(f.openings) }),
    ...(x.bandHidden
      ? {}
      : { salaryBandMin: num(f.salaryBandMin), salaryBandMax: num(f.salaryBandMax) }),
    description: f.description,
    competencies: x.competencies,
    entityId: f.entityId,
    departmentId: f.departmentId,
    grade: orNull(f.grade),
    jdTemplateTitle: orNull(f.jdTemplateTitle),
    hiringManagerId: x.manager?.id,
    ownerId: x.owner?.id ?? null,
    salaryCurrency: f.salaryCurrency,
    targetCloseDate: f.targetCloseDate || undefined,
    businessNeed: orNull(f.businessNeed),
    alternativesConsidered: orNull(f.alternativesConsidered),
    hmSeesSalary: x.hmSeesSalary,
  };
}

/** Loads the requisition (edit) once, then renders the form seeded from it. */
export function RequisitionForm({ id }: { id?: string }) {
  const org = useOrgOptions();
  const detail = useHiringQuery<Detail>(id ? `/api/hiring/requisitions/${id}` : null);
  return (
    <QueryState isLoading={org.isLoading || detail.isLoading} error={org.error ?? detail.error}>
      <RequisitionFormBody id={id} detail={detail.data} />
    </QueryState>
  );
}

function RequisitionFormBody({ id, detail }: { id?: string; detail?: Detail }) {
  const t = useTranslations("hiring.requisitionForm");
  const router = useRouter();
  const locale = useLocale();
  const org = useOrgOptions();
  const templates = useHiringQuery<Template[]>("/api/hiring/library/jd-templates");
  const seed = seedFrom(detail);
  const [f, setF] = useState(seed.form);
  const [competencies, setCompetencies] = useState<string[]>(seed.competencies);
  const [manager, setManager] = useState<Person | null>(seed.manager);
  const [owner, setOwner] = useState<Person | null>(seed.owner);
  const [hmSeesSalary, setHmSeesSalary] = useState(seed.hmSeesSalary);
  const set = (k: keyof typeof EMPTY) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const bandHidden = seed.bandHidden;

  const pickTemplate = (templateId: string) => {
    const tpl = templates.data?.find((x) => x.id === templateId);
    if (!tpl) return;
    setF((x) => ({
      ...x,
      title: tpl.title,
      description: tpl.description,
      grade: tpl.grade ?? "",
      jdTemplateTitle: tpl.title,
    }));
    setCompetencies(tpl.competencies);
  };

  const done = (r: { id: string }) => router.push(`/${locale}/hiring/requisitions/${r.id}`);
  const create = useHiringMutation<object, { id: string }>("POST", "/api/hiring/requisitions", {
    onSuccess: done,
  });
  const update = useHiringMutation<object, { id: string }>(
    "PUT",
    `/api/hiring/requisitions/${id}`,
    { onSuccess: done },
  );
  const mutation = id ? update : create;
  const locked = Boolean(detail && detail.status !== "DRAFT");
  const body = requestBody(f, { locked, bandHidden, competencies, manager, owner, hmSeesSalary });

  return (
    <>
      <div className="space-y-4">
        <PageHeader title={id ? t("editTitle") : t("newTitle")} subtitle={t("subtitle")} />
        {locked ? <Notice tone="info">{t("lockedNotice")}</Notice> : null}
        <SectionCard title={t("roleSection")}>
          <div className="grid gap-4 md:grid-cols-2">
            {!id ? (
              <Field
                label={t("template")}
                htmlFor="rf-tpl"
                hint={t("templateHint")}
                className="md:col-span-2"
              >
                <NativeSelect
                  id="rf-tpl"
                  defaultValue=""
                  onChange={(e) => pickTemplate(e.target.value)}
                >
                  <option value="">{t("noTemplate")}</option>
                  {(templates.data ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.title}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            <Field label={t("jobTitle")} htmlFor="rf-title" required>
              <Input
                id="rf-title"
                value={f.title}
                disabled={locked}
                onChange={(e) => set("title")(e.target.value)}
              />
            </Field>
            <Field label={t("grade")} htmlFor="rf-grade" hint={t("gradeHint")}>
              <Input id="rf-grade" value={f.grade} onChange={(e) => set("grade")(e.target.value)} />
            </Field>
            <Field label={t("entity")} htmlFor="rf-entity" required>
              <NativeSelect
                id="rf-entity"
                value={f.entityId}
                onChange={(e) =>
                  setF((x) => ({ ...x, entityId: e.target.value, departmentId: "" }))
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
            <Field label={t("department")} htmlFor="rf-dept" required>
              <NativeSelect
                id="rf-dept"
                value={f.departmentId}
                disabled={!f.entityId}
                onChange={(e) => set("departmentId")(e.target.value)}
              >
                <option value="">{t("choose")}</option>
                {org.departmentsOf(f.entityId).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("hiringManager")} htmlFor="rf-hm" required>
              <PersonPicker id="rf-hm" value={manager} onChange={setManager} />
            </Field>
            <Field label={t("owner")} htmlFor="rf-owner" hint={t("ownerHint")}>
              <PersonPicker
                id="rf-owner"
                value={owner}
                onChange={setOwner}
                permission="hiring.manage"
                entityId={f.entityId || null}
              />
            </Field>
          </div>
        </SectionCard>
        <SectionCard
          title={t("jdSection")}
          subtitle={t("jdHint")}
          actions={
            <JdFileButtons onDescription={set("description")} onCompetencies={setCompetencies} />
          }
        >
          <div className="space-y-4">
            <Field label={t("description")} htmlFor="rf-desc" required>
              <Textarea
                id="rf-desc"
                className="min-h-48"
                value={f.description}
                onChange={(e) => set("description")(e.target.value)}
              />
            </Field>
            <Field label={t("competencies")} required>
              <CompetencyPicker value={competencies} onChange={setCompetencies} />
            </Field>
          </div>
        </SectionCard>
        <SectionCard title={t("businessSection")}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("businessNeed")} htmlFor="rf-need">
              <Textarea
                id="rf-need"
                value={f.businessNeed}
                onChange={(e) => set("businessNeed")(e.target.value)}
              />
            </Field>
            <Field label={t("alternatives")} htmlFor="rf-alt">
              <Textarea
                id="rf-alt"
                value={f.alternativesConsidered}
                onChange={(e) => set("alternativesConsidered")(e.target.value)}
              />
            </Field>
          </div>
        </SectionCard>
        <CompSection
          f={f}
          set={set}
          bandHidden={bandHidden}
          locked={locked}
          hmSeesSalary={hmSeesSalary}
          setHmSeesSalary={setHmSeesSalary}
        />
        {mutation.error ? <Notice tone="danger">{mutation.error.message}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => router.back()}>
            {t("cancel")}
          </Button>
          <Button
            disabled={mutation.isPending || !f.title || !manager}
            onClick={() => mutation.mutate(body)}
          >
            {t("save")}
          </Button>
        </div>
      </div>
    </>
  );
}
