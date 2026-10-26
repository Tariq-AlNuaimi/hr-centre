import type { ContractType, Gender } from "@/generated/prisma/client";

/**
 * The HR Centre employee record — blueprint §2 (F-b) — in its natural form, as
 * every writer hands it over (form, import, the future Odoo sync).
 *
 * Every field is optional with one meaning for each state, shared by all
 * writers:
 *   - `undefined` — not supplied (the sheet has no such column, the form did not
 *     send it): leave what is on file alone;
 *   - `null`      — supplied and empty: clear it;
 *   - a value     — set it.
 */
export type EmployeeRecordInput = {
  jobTitle?: string | null;
  grade?: string | null;
  contractType?: ContractType | null;
  probationEndDate?: Date | null;
  workLocation?: string | null;
  workPhone?: string | null;
  personalEmail?: string | null;
  personalPhone?: string | null;
  dateOfBirth?: Date | null;
  gender?: Gender | null;
  nationality?: string | null;
  civilIdNumber?: string | null;
  civilIdExpiry?: Date | null;
  passportNumber?: string | null;
  passportExpiry?: Date | null;
};

export const JOB_FIELDS = [
  "jobTitle",
  "grade",
  "contractType",
  "probationEndDate",
  "workLocation",
] as const;
export const CONTACT_FIELDS = ["workPhone"] as const;
/** Confidential — gated by `people.viewPersonal`. */
export const PERSONAL_FIELDS = [
  "personalEmail",
  "personalPhone",
  "dateOfBirth",
  "gender",
  "nationality",
] as const;
/** Restricted — gated by `people.viewIdDocuments`; numbers encrypted at rest. */
export const ID_DOCUMENT_FIELDS = [
  "civilIdNumber",
  "civilIdExpiry",
  "passportNumber",
  "passportExpiry",
] as const;

export type RecordField = keyof EmployeeRecordInput;

export const RECORD_FIELDS: readonly RecordField[] = [
  ...JOB_FIELDS,
  ...CONTACT_FIELDS,
  ...PERSONAL_FIELDS,
  ...ID_DOCUMENT_FIELDS,
];

export const DATE_RECORD_FIELDS = new Set<RecordField>([
  "probationEndDate",
  "dateOfBirth",
  "civilIdExpiry",
  "passportExpiry",
]);

/** Which permission a write of these fields needs, beyond editing people at all. */
export function recordFieldsTouched(input: EmployeeRecordInput): {
  personal: boolean;
  idDocuments: boolean;
} {
  const has = (fields: readonly RecordField[]) => fields.some((f) => input[f] !== undefined);
  return { personal: has(PERSONAL_FIELDS), idDocuments: has(ID_DOCUMENT_FIELDS) };
}
