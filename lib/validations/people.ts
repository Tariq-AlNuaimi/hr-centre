import { z } from "zod";
import { createEmployeeSchema, isoDate } from "./employee";

/**
 * Boundary validation for the HR Centre employee record — blueprint §2 (F-b),
 * AC-F2.1: "validation messages say which field and why". Every message below
 * is phrased to stand on its own after `field: ` (lib/org/http.ts).
 *
 * All fields optional + nullable, with the writer's meaning (lib/people/record.ts):
 * absent = leave alone, null = clear, value = set.
 */

/** JML S1 (ADR-076) — the one employment-type list, in display order. */
export const CONTRACT_TYPES = [
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
] as const;
export const GENDERS = ["MALE", "FEMALE"] as const;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const phone = z
  .string()
  .trim()
  .regex(
    /^$|^\+?[0-9 ()-]{6,20}$/,
    "Use digits, spaces, brackets or dashes, optionally starting with +",
  )
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/** Civil ID / passport number: letters and digits only, as printed on the card. */
const idNumber = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, "").toUpperCase())
  .refine(
    (v) => v === "" || /^[A-Z0-9]{4,20}$/.test(v),
    "Use 4–20 letters or digits, as printed on the document",
  )
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const day = isoDate.nullable().optional();

export const employeeRecordSchema = z
  .object({
    jobTitle: text(120),
    grade: text(40),
    contractType: z.enum(CONTRACT_TYPES).nullable().optional(),
    probationEndDate: day,
    workLocation: text(120),
    workPhone: phone,
    personalEmail: z
      .union([z.literal(""), z.email("Enter a valid email address")])
      .transform((v) => (v === "" ? null : v.toLowerCase()))
      .nullable()
      .optional(),
    personalPhone: phone,
    dateOfBirth: day.refine(
      (v) => !v || v <= new Date().toISOString().slice(0, 10),
      "A date of birth cannot be in the future",
    ),
    gender: z.enum(GENDERS).nullable().optional(),
    nationality: text(60),
    civilIdNumber: idNumber,
    civilIdExpiry: day,
    passportNumber: idNumber,
    passportExpiry: day,
  })
  .strict();

/** POST /api/employees — the core record (same rules as the import) + the details. */
export const addEmployeeSchema = z.object({
  employee: createEmployeeSchema,
  record: employeeRecordSchema.default({}),
});

export type EmployeeRecordBody = z.infer<typeof employeeRecordSchema>;
export type AddEmployeeBody = z.infer<typeof addEmployeeSchema>;

/** ISO day strings → the writer's Date values; other fields pass through. */
export function recordFromBody(body: EmployeeRecordBody) {
  const date = (v: string | null | undefined) =>
    v === undefined ? undefined : v === null ? null : new Date(`${v}T00:00:00Z`);
  return {
    ...body,
    probationEndDate: date(body.probationEndDate),
    dateOfBirth: date(body.dateOfBirth),
    civilIdExpiry: date(body.civilIdExpiry),
    passportExpiry: date(body.passportExpiry),
  };
}
