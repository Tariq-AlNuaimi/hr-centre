"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { EmployeePicker } from "@/components/pms/EmployeePicker";
import { apiClient } from "@/lib/api-client";
import { Field } from "../Field";
import { EMPLOYMENT_TYPES } from "../joiners/JoinerFields";
import { LoadFailed, LoadingBlock } from "../States";
import { useJmlAction, useJmlLookups } from "../use-jml";
import type { MoveProfile } from "./MoverStart";

const CHANGE_TYPES = [
  "DEPARTMENT_TRANSFER",
  "INTERNSHIP_TO_TRAINING",
  "INTERNSHIP_TO_EMPLOYMENT",
  "TRAINING_TO_EMPLOYMENT",
] as const;

/**
 * The change itself: type (with what it allows), effective date and the new
 * details, pre-filled with today's. Only the fields that differ are sent.
 */
export function MoverForm({
  profile,
  onCreated,
}: {
  profile: MoveProfile;
  onCreated: (caseId: string) => void;
}) {
  const t = useTranslations("jml.movers");
  const tc = useTranslations("people.record.contract");
  const lookups = useJmlLookups();
  const { run, busy } = useJmlAction(t("failed"));
  const [changeType, setChangeType] = useState<string>("DEPARTMENT_TRANSFER");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [d, setD] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(profile.details).map(([k, v]) => [k, v ?? ""])),
  );
  const [managerName, setManagerName] = useState(profile.labels.managerId ?? "");
  if (lookups.isLoading) return <LoadingBlock />;
  if (lookups.isError || !lookups.data) return <LoadFailed />;
  const l = lookups.data;
  const set = (k: string, v: string) => setD((prev) => ({ ...prev, [k]: v }));
  const departments = l.departments.filter((x) => x.entityId === d.entityId);
  const teams = l.teams.filter((x) => x.departmentId === d.departmentId);

  async function submit() {
    const newDetails = Object.fromEntries(
      Object.entries(d)
        .filter(([k, v]) => (profile.details[k] ?? "") !== v)
        .map(([k, v]) => [k, v === "" ? null : v]),
    );
    const result = await run(
      () =>
        apiClient.post<{ caseId: string }>("/api/jml/movers", {
          employeeId: profile.employee.id,
          changeType,
          effectiveDate,
          newDetails,
        }),
      t("started"),
    );
    if (result) onCreated(result.caseId);
  }

  return (
    <SectionCard title={t("formTitle")} subtitle={t("formNote")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="mv-type" label={t("changeTypeLabel")} hint={t(`changeHint.${changeType}`)}>
          <NativeSelect
            id="mv-type"
            className="w-full"
            value={changeType}
            onChange={(e) => setChangeType(e.target.value)}
          >
            {CHANGE_TYPES.map((c) => (
              <option key={c} value={c}>
                {t(`changeType.${c}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="mv-date" label={t("effectiveDate")}>
          <Input
            id="mv-date"
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
        </Field>
        <Field id="mv-company" label={t("field.entityId")}>
          <NativeSelect
            id="mv-company"
            className="w-full"
            value={d.entityId}
            onChange={(e) => {
              set("entityId", e.target.value);
              set("departmentId", "");
              set("teamId", "");
            }}
          >
            {l.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="mv-dept" label={t("field.departmentId")}>
          <NativeSelect
            id="mv-dept"
            className="w-full"
            value={d.departmentId}
            onChange={(e) => set("departmentId", e.target.value)}
          >
            <option value="">{t("none")}</option>
            {departments.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="mv-team" label={t("field.teamId")}>
          <NativeSelect
            id="mv-team"
            className="w-full"
            value={d.teamId}
            onChange={(e) => set("teamId", e.target.value)}
          >
            <option value="">{t("none")}</option>
            {teams.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="mv-title" label={t("field.jobTitle")}>
          <Input
            id="mv-title"
            value={d.jobTitle}
            onChange={(e) => set("jobTitle", e.target.value)}
          />
        </Field>
        <Field id="mv-etype" label={t("field.employmentType")}>
          <NativeSelect
            id="mv-etype"
            className="w-full"
            value={d.employmentType}
            onChange={(e) => set("employmentType", e.target.value)}
          >
            <option value="">{t("none")}</option>
            {EMPLOYMENT_TYPES.map((x) => (
              <option key={x} value={x}>
                {tc(x)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="mv-ctype" label={t("field.contractTypeId")}>
          <NativeSelect
            id="mv-ctype"
            className="w-full"
            value={d.contractTypeId}
            onChange={(e) => set("contractTypeId", e.target.value)}
          >
            <option value="">{t("none")}</option>
            {l.contractTypes.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="mv-loc" label={t("field.workLocation")}>
          <Input
            id="mv-loc"
            value={d.workLocation}
            onChange={(e) => set("workLocation", e.target.value)}
          />
        </Field>
        <div>
          <p className="mb-1 text-sm font-medium text-foreground">{t("field.managerId")}</p>
          <p className="mb-1 text-sm">{managerName || t("none")}</p>
          <EmployeePicker
            id="mv-manager"
            label={t("newManager")}
            exclude={[profile.employee.id]}
            onPick={(x) => {
              set("managerId", x.id);
              setManagerName(x.name);
            }}
          />
        </div>
      </div>
      <div className="mt-4">
        <Button onClick={() => void submit()} disabled={busy || !effectiveDate}>
          {t("start")}
        </Button>
      </div>
    </SectionCard>
  );
}
