"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { SectionCard } from "@/components/shared/SectionCard";
import { NATIONALITIES } from "@/lib/hiring/nationalities";
import { CANDIDATE_SOURCES } from "@/lib/validations/hiring/candidate";
import { Field } from "../ui/fields";
import { PersonPicker, type Person } from "../ui/person-picker";
import { useRequisitionOptions } from "../ui/requisition-options";

/**
 * Add / edit a candidate (Interview Hub `CandidateForm`). The stage is never on
 * this form — a new candidate always starts at New application, and only the
 * stage rail moves one. Pay and DEI fields appear only for readers who may
 * see them; the national ID is Restricted and encrypted at rest.
 */
export type CandidateFormValues = {
  requisitionId: string;
  name: string;
  email: string;
  phone: string;
  nationality: string;
  currentEmployer: string;
  linkedinUrl: string;
  gender: string;
  nec: string;
  source: string;
  sourceAttribution: string;
  referredBy: Person | null;
  salaryExpectation: string;
};

export const EMPTY_CANDIDATE: CandidateFormValues = {
  requisitionId: "",
  name: "",
  email: "",
  phone: "",
  nationality: "",
  currentEmployer: "",
  linkedinUrl: "",
  gender: "",
  nec: "",
  source: "MANUAL_ENTRY",
  sourceAttribution: "",
  referredBy: null,
  salaryExpectation: "",
};

/** Form values → the API body (empty strings clear; hidden fields are not sent at all). */
export function toBody(
  v: CandidateFormValues,
  opts: { comp: boolean; dei: boolean; pii: boolean },
) {
  return {
    requisitionId: v.requisitionId || null,
    name: v.name.trim(),
    email: v.email,
    phone: v.phone,
    nationality: v.nationality,
    currentEmployer: v.currentEmployer,
    linkedinUrl: v.linkedinUrl,
    source: v.source,
    sourceAttribution: v.sourceAttribution,
    referredById: v.source === "REFERRAL" ? (v.referredBy?.id ?? null) : null,
    ...(opts.pii ? { nec: v.nec } : {}),
    ...(opts.dei ? { gender: v.gender || null } : {}),
    ...(opts.comp
      ? { salaryExpectation: v.salaryExpectation === "" ? null : Number(v.salaryExpectation) }
      : {}),
  };
}

export function CandidateForm({
  initial,
  show,
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: CandidateFormValues;
  show: { comp: boolean; dei: boolean; pii: boolean };
  submitting: boolean;
  submitLabel: string;
  onSubmit: (v: CandidateFormValues) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("hiring.candidateForm");
  const tsrc = useTranslations("hiring.source");
  const [v, setV] = useState(initial);
  const { options: reqs } = useRequisitionOptions();
  const set = (k: keyof CandidateFormValues) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      <SectionCard title={t("sectionCandidate")} subtitle={t("sectionCandidateHint")}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label={t("requisition")}
            htmlFor="cf-req"
            hint={t("requisitionHint")}
            className="md:col-span-2"
          >
            <NativeSelect id="cf-req" value={v.requisitionId} onChange={set("requisitionId")}>
              <option value="">{t("noRequisition")}</option>
              {reqs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("name")} htmlFor="cf-name" required>
            <Input id="cf-name" value={v.name} maxLength={255} onChange={set("name")} />
          </Field>
          <Field label={t("email")} htmlFor="cf-email">
            <Input id="cf-email" type="email" value={v.email} onChange={set("email")} />
          </Field>
          <Field label={t("phone")} htmlFor="cf-phone" hint={t("phoneHint")}>
            <Input
              id="cf-phone"
              inputMode="tel"
              placeholder="+968"
              value={v.phone}
              onChange={set("phone")}
            />
          </Field>
          <Field label={t("nationality")} htmlFor="cf-nat">
            <Input
              id="cf-nat"
              list="cf-nat-list"
              value={v.nationality}
              onChange={set("nationality")}
            />
            <datalist id="cf-nat-list">
              {NATIONALITIES.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </Field>
        </div>
      </SectionCard>
      <SectionCard title={t("sectionProfile")} subtitle={t("sectionProfileHint")}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t("employer")} htmlFor="cf-emp">
            <Input id="cf-emp" value={v.currentEmployer} onChange={set("currentEmployer")} />
          </Field>
          <Field label={t("linkedin")} htmlFor="cf-li">
            <Input
              id="cf-li"
              type="url"
              placeholder={t("linkedinPlaceholder")}
              value={v.linkedinUrl}
              onChange={set("linkedinUrl")}
            />
          </Field>
          {show.dei ? (
            <Field label={t("gender")} htmlFor="cf-gender" hint={t("genderHint")}>
              <NativeSelect id="cf-gender" value={v.gender} onChange={set("gender")}>
                <option value="">{t("preferNot")}</option>
                <option value="Male">{t("male")}</option>
                <option value="Female">{t("female")}</option>
              </NativeSelect>
            </Field>
          ) : null}
          {show.comp ? (
            <Field label={t("expectation")} htmlFor="cf-exp" hint={t("expectationHint")}>
              <Input
                id="cf-exp"
                type="number"
                min={0}
                value={v.salaryExpectation}
                onChange={set("salaryExpectation")}
              />
            </Field>
          ) : null}
          {show.pii ? (
            <Field label={t("nec")} htmlFor="cf-nec" hint={t("necHint")} className="md:col-span-2">
              <Input
                id="cf-nec"
                autoComplete="off"
                maxLength={64}
                value={v.nec}
                onChange={set("nec")}
              />
            </Field>
          ) : null}
        </div>
      </SectionCard>
      <SectionCard title={t("sectionSourcing")} subtitle={t("sectionSourcingHint")}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t("source")} htmlFor="cf-src" required>
            <NativeSelect id="cf-src" value={v.source} onChange={set("source")}>
              {CANDIDATE_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {tsrc(s)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("attribution")} htmlFor="cf-attr" hint={t("attributionHint")}>
            <Input id="cf-attr" value={v.sourceAttribution} onChange={set("sourceAttribution")} />
          </Field>
          {v.source === "REFERRAL" ? (
            <Field
              label={t("referredBy")}
              htmlFor="cf-ref"
              hint={t("referredByHint")}
              className="md:col-span-2"
            >
              <PersonPicker
                id="cf-ref"
                value={v.referredBy}
                onChange={(p) => setV({ ...v, referredBy: p })}
              />
            </Field>
          ) : null}
        </div>
      </SectionCard>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={submitting || !v.name.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
