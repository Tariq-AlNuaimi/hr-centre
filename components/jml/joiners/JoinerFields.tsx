"use client";

import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { Field } from "../Field";
import type { Lookups } from "../use-jml";

/**
 * The joiner form's sections — Onboarding `FormFields` (Candidate, Where they
 * sit, Employment, Pay, IT requirements, Introduction) on the HR Centre record.
 */

export type JoinerValues = {
  fullName: string;
  workEmail: string;
  personalEmail: string;
  phone: string;
  nationality: string;
  entityId: string;
  departmentId: string;
  teamId: string;
  roleTrack: string;
  jobTitle: string;
  employmentType: string;
  contractTypeId: string;
  plannedStartDate: string;
  contractStartDate: string;
  contractEndDate: string;
  probationMonths: string;
  workLocation: string;
  manager: { id: string; name: string } | null;
  salary: string;
  payrollApplicable: boolean;
  clientAssignedRole: boolean | null;
  introSentence: string;
  hobbies: string;
  msAccountRequired: boolean | null;
  laptopRequired: boolean | null;
  accessCardRequired: boolean | null;
};

export const EMPLOYMENT_TYPES = [
  "PERMANENT",
  "FIXED_TERM",
  "PART_TIME",
  "INTERN",
  "SUMMER_INTERN",
  "TRAINEE",
  "SECONDMENT",
  "FREELANCER",
  "CONSULTANT",
  "CONTRACTOR",
  "TEMPORARY",
];
const ROLE_TRACKS = ["INDIVIDUAL", "LEAD", "MANAGER", "DIRECTOR", "C_LEVEL"];

export type SetFn = <K extends keyof JoinerValues>(key: K, value: JoinerValues[K]) => void;

export function Tri({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  const t = useTranslations("jml.joiners.form");
  return (
    <Field id={id} label={label}>
      <NativeSelect
        id={id}
        className="w-full"
        value={value === null ? "" : value ? "yes" : "no"}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "yes")}
      >
        <option value="">{t("notAnswered")}</option>
        <option value="yes">{t("yes")}</option>
        <option value="no">{t("no")}</option>
      </NativeSelect>
    </Field>
  );
}

export function Text({
  id,
  label,
  value,
  onChange,
  type = "text",
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  hint?: string;
}) {
  return (
    <Field id={id} label={label} hint={hint}>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function CandidateSection({ v, set }: { v: JoinerValues; set: SetFn }) {
  const t = useTranslations("jml.joiners.form");
  return (
    <SectionCard title={t("section.candidate")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Text
          id="j-name"
          label={t("fullName")}
          value={v.fullName}
          onChange={(x) => set("fullName", x)}
        />
        <Text
          id="j-pemail"
          label={t("personalEmail")}
          type="email"
          value={v.personalEmail}
          onChange={(x) => set("personalEmail", x)}
        />
        <Text id="j-phone" label={t("phone")} value={v.phone} onChange={(x) => set("phone", x)} />
        <Text
          id="j-nat"
          label={t("nationality")}
          value={v.nationality}
          onChange={(x) => set("nationality", x)}
          hint={t("nationalityHint")}
        />
        <Text
          id="j-wemail"
          label={t("workEmail")}
          type="email"
          value={v.workEmail}
          onChange={(x) => set("workEmail", x)}
          hint={t("workEmailHint")}
        />
      </div>
    </SectionCard>
  );
}

export function PlacementSection({
  v,
  set,
  lookups,
}: {
  v: JoinerValues;
  set: SetFn;
  lookups: Lookups;
}) {
  const t = useTranslations("jml.joiners.form");
  const tr = useTranslations("jml.vocab.roleTrack");
  const departments = lookups.departments.filter((d) => d.entityId === v.entityId);
  const teams = lookups.teams.filter((x) => x.departmentId === v.departmentId);
  return (
    <SectionCard title={t("section.placement")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="j-company" label={t("company")}>
          <NativeSelect
            id="j-company"
            className="w-full"
            value={v.entityId}
            onChange={(e) => {
              set("entityId", e.target.value);
              set("departmentId", "");
              set("teamId", "");
            }}
          >
            <option value="">{t("choose")}</option>
            {lookups.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="j-track" label={t("roleTrack")} hint={t("roleTrackHint")}>
          <NativeSelect
            id="j-track"
            className="w-full"
            value={v.roleTrack}
            onChange={(e) => set("roleTrack", e.target.value)}
          >
            {ROLE_TRACKS.map((r) => (
              <option key={r} value={r}>
                {tr(r)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="j-dept" label={t("department")}>
          <NativeSelect
            id="j-dept"
            className="w-full"
            value={v.departmentId}
            disabled={!v.entityId || v.roleTrack === "C_LEVEL"}
            onChange={(e) => {
              set("departmentId", e.target.value);
              set("teamId", "");
            }}
          >
            <option value="">{t("choose")}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="j-team" label={t("team")}>
          <NativeSelect
            id="j-team"
            className="w-full"
            value={v.teamId}
            disabled={teams.length === 0}
            onChange={(e) => set("teamId", e.target.value)}
          >
            <option value="">{t("noTeam")}</option>
            {teams.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
    </SectionCard>
  );
}
