"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import {
  ID_DOCUMENT_FIELDS,
  JOB_FIELDS,
  CONTACT_FIELDS,
  PERSONAL_FIELDS,
  type RecordField,
} from "@/lib/people/record";
import { CONTRACT_TYPES, GENDERS } from "@/lib/validations/people";

/**
 * The record inputs, grouped as the blueprint groups them (§2). Shared by Add
 * employee and Edit details so both send the same field names and formats the
 * zod schema expects (empty string = clear).
 *
 * The personal and ID groups render only when the viewer may see them — the
 * API refuses the write otherwise, and a control that always 403s is a lie.
 */
export type RecordValues = Partial<Record<RecordField, string>>;

const DATE_FIELDS = new Set<RecordField>([
  "probationEndDate",
  "dateOfBirth",
  "civilIdExpiry",
  "passportExpiry",
]);

export function RecordFields({
  values,
  onChange,
  showPersonal,
  showIdDocuments,
  disabled,
}: {
  values: RecordValues;
  onChange: (field: RecordField, value: string) => void;
  showPersonal: boolean;
  showIdDocuments: boolean;
  disabled: boolean;
}) {
  const t = useTranslations("people.record");

  const field = (name: RecordField) => {
    const id = `record-${name}`;
    let control;
    if (name === "contractType" || name === "gender") {
      const options = name === "contractType" ? CONTRACT_TYPES : GENDERS;
      const prefix = name === "contractType" ? "contract" : "genderValue";
      control = (
        <NativeSelect
          id={id}
          value={values[name] ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(name, e.target.value)}
          className="w-full"
        >
          <option value="">{t("notSet")}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {t(`${prefix}.${o}`)}
            </option>
          ))}
        </NativeSelect>
      );
    } else {
      control = (
        <Input
          id={id}
          type={DATE_FIELDS.has(name) ? "date" : name === "personalEmail" ? "email" : "text"}
          value={values[name] ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(name, e.target.value)}
        />
      );
    }
    return (
      <div key={name}>
        <label htmlFor={id} className="mb-1 block text-sm font-medium text-foreground">
          {t(name)}
        </label>
        {control}
      </div>
    );
  };

  const group = (title: string, fields: readonly RecordField[]) => (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-semibold text-foreground">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{fields.map(field)}</div>
    </fieldset>
  );

  return (
    <div className="space-y-6">
      {group(t("jobSection"), [...JOB_FIELDS, ...CONTACT_FIELDS])}
      {showPersonal ? group(t("personalSection"), PERSONAL_FIELDS) : null}
      {showIdDocuments ? group(t("idSection"), ID_DOCUMENT_FIELDS) : null}
    </div>
  );
}

/** Only the groups the viewer may write, so a hidden field is never sent. */
export function recordPayload(
  values: RecordValues,
  groups: { personal: boolean; idDocuments: boolean },
): RecordValues {
  const fields: RecordField[] = [
    ...JOB_FIELDS,
    ...CONTACT_FIELDS,
    ...(groups.personal ? PERSONAL_FIELDS : []),
    ...(groups.idDocuments ? ID_DOCUMENT_FIELDS : []),
  ];
  return Object.fromEntries(fields.map((f) => [f, values[f] ?? ""]));
}
