import { z } from "zod";
import { CONTRACT_TYPES } from "@/lib/validations/people";
import { isoDay } from "./config";

/**
 * Joiner boundaries — HR Onboarding `lib/validations/new-hire.ts`, re-pointed
 * at the core record (D8): the person's name, emails, phone, nationality,
 * placement, job title, employment type, work location, line manager and salary
 * are written to the PRE_JOINER `Employee`; the rest to `JmlJoinDetail`.
 *
 * Differences from the source, each forced by the core record:
 *  - a draft needs a company AND a department (the core employee row requires
 *    both unless the person is C-Level) — Onboarding allowed a name alone;
 *  - the line manager is an employee (`managerId`, D13), not free text;
 *  - the work email is optional until it is issued (a placeholder holds the
 *    unique column until then).
 */

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters`)
    .transform((v) => (v === "" ? null : v))
    .nullable();

const email = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.email("Enter a valid email address").max(254).nullable())
  .nullable();

const id = z.string().trim().min(1).max(64);

const ROLE_TRACKS = ["C_LEVEL", "DIRECTOR", "MANAGER", "LEAD", "INDIVIDUAL"] as const;

const joinerFields = {
  fullName: z.string().trim().min(1, "Full name is required").max(200),
  workEmail: email,
  personalEmail: email,
  phone: text(40),
  nationality: text(80),
  entityId: id,
  departmentId: id.nullable(),
  teamId: id.nullable(),
  roleTrack: z.enum(ROLE_TRACKS),
  jobTitle: text(200),
  employmentType: z.enum(CONTRACT_TYPES).nullable(),
  contractTypeId: id.nullable(),
  plannedStartDate: isoDay.nullable(),
  contractStartDate: isoDay.nullable(),
  contractEndDate: isoDay.nullable(),
  probationMonths: z.number().int().min(0).max(36).nullable(),
  workLocation: text(120),
  managerId: id.nullable(),
  /** Plaintext decimal; encrypted by the writer. Honoured only with `people.viewSalary`. */
  salary: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,3})?$/, "Enter an amount like 1500 or 1500.500")
    .nullable(),
  payrollApplicable: z.boolean(),
  clientAssignedRole: z.boolean().nullable(),
  introSentence: text(2000),
  hobbies: text(2000),
  msAccountRequired: z.boolean().nullable(),
  laptopRequired: z.boolean().nullable(),
  accessCardRequired: z.boolean().nullable(),
};

function contractOrder(
  v: { contractStartDate?: Date | null; contractEndDate?: Date | null },
  ctx: z.RefinementCtx,
) {
  if (v.contractStartDate && v.contractEndDate && v.contractEndDate < v.contractStartDate) {
    ctx.addIssue({
      code: "custom",
      path: ["contractEndDate"],
      message: "The contract cannot end before it starts",
    });
  }
}

const draftShape = z.object({
  ...joinerFields,
  workEmail: joinerFields.workEmail.default(null),
  personalEmail: joinerFields.personalEmail.default(null),
  phone: joinerFields.phone.default(null),
  nationality: joinerFields.nationality.default(null),
  departmentId: joinerFields.departmentId.default(null),
  teamId: joinerFields.teamId.default(null),
  roleTrack: joinerFields.roleTrack.default("INDIVIDUAL"),
  jobTitle: joinerFields.jobTitle.default(null),
  employmentType: joinerFields.employmentType.default(null),
  contractTypeId: joinerFields.contractTypeId.default(null),
  plannedStartDate: joinerFields.plannedStartDate.default(null),
  contractStartDate: joinerFields.contractStartDate.default(null),
  contractEndDate: joinerFields.contractEndDate.default(null),
  probationMonths: joinerFields.probationMonths.default(null),
  workLocation: joinerFields.workLocation.default(null),
  managerId: joinerFields.managerId.default(null),
  salary: joinerFields.salary.default(null),
  payrollApplicable: joinerFields.payrollApplicable.optional(),
  clientAssignedRole: joinerFields.clientAssignedRole.default(null),
  introSentence: joinerFields.introSentence.default(null),
  hobbies: joinerFields.hobbies.default(null),
  msAccountRequired: joinerFields.msAccountRequired.default(null),
  laptopRequired: joinerFields.laptopRequired.default(null),
  accessCardRequired: joinerFields.accessCardRequired.default(null),
});

/** Save a draft (AC-NEW-001: no code, case number, task, email or IT submission). */
export const draftJoinerSchema = draftShape.superRefine(contractOrder);
export type DraftJoinerInput = z.infer<typeof draftJoinerSchema>;

/** Partial edit — absent = keep, null = clear (§9.5: every field stays editable). */
export const updateJoinerSchema = z
  .object(joinerFields)
  .partial()
  .extend({ expectedVersion: z.number().int().min(0).optional() })
  .superRefine(contractOrder);
export type UpdateJoinerInput = z.infer<typeof updateJoinerSchema>;

export const activationSchema = z.object({
  duplicateOverrideReason: z.string().trim().min(10).max(1000).optional(),
});

export const joinerListSchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(["all", "draft", "active"]).default("all"),
  entityId: id.optional(),
  departmentId: id.optional(),
  employmentType: z.enum(CONTRACT_TYPES).optional(),
});

/** Hiring → JML (D8): the employee already exists as a PRE_JOINER. */
const openJoinCaseSchema = z.object({
  employeeId: id,
  sourceRef: z.string().trim().min(3).max(120),
  plannedStartDate: isoDay.nullable().default(null),
  contractTypeId: id.nullable().default(null),
  probationMonths: z.number().int().min(0).max(36).nullable().default(null),
  payrollApplicable: z.boolean().optional(),
});
export type OpenJoinCaseInput = z.infer<typeof openJoinCaseSchema>;
