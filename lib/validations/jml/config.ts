import { z } from "zod";
import { CONTRACT_TYPES } from "@/lib/validations/people";
import { CASE_TYPES } from "./template";

/** JML configuration boundaries (Onboarding/Offboarding admin schemas, merged). */

export const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .transform((v, ctx) => {
    const d = new Date(`${v}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
      ctx.addIssue({ code: "custom", message: "Not a real calendar date" });
      return z.NEVER;
    }
    const year = d.getUTCFullYear();
    const now = new Date().getUTCFullYear();
    // Offboarding walkthrough defect "year 60901": plausible years only.
    if (year < now - 20 || year > now + 10) {
      ctx.addIssue({ code: "custom", message: "That year is outside the plausible range" });
      return z.NEVER;
    }
    return d;
  });

const validZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const scheduleSchema = z
  .object({
    workingDays: z.array(z.number().int().min(1).max(7)).min(1, "At least one working day").max(7),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
    timeZone: z.string().trim().min(1).max(64).refine(validZone, "Not a valid IANA time zone"),
  })
  .refine((s) => s.endHour > s.startHour, {
    message: "The window must end after it starts",
    path: ["endHour"],
  });

export const holidaySchema = z.object({
  date: isoDay,
  name: z.string().trim().min(2).max(120),
});

export const statutoryCreateSchema = z.object({
  key: z.string().trim().min(3).max(80),
  value: z
    .string()
    .trim()
    .regex(/^-?\d{1,12}(\.\d{1,6})?$/, "A decimal with up to 12 digits and 6 decimals"),
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .transform((v) => new Date(`${v}T00:00:00Z`)),
  effectiveTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .transform((v) => new Date(`${v}T00:00:00Z`))
    .nullable()
    .default(null),
  note: z.string().trim().max(1000).nullable().default(null),
});

export const statutoryVerifySchema = z.object({
  verified: z.boolean(),
  sourceReference: z.string().trim().min(3).max(500).nullable().optional(),
});

export const classificationCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{1,31}$/, "Capitals, digits, dashes or underscores"),
  label: z.string().trim().min(2).max(120),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

export const classificationUpdateSchema = z.object({
  label: z.string().trim().min(2).max(120).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  active: z.boolean().optional(),
});

export const contractTypeCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(24)
    .regex(/^[A-Z0-9-]+$/, "Capitals, digits and dashes"),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

export const contractTypeUpdateSchema = contractTypeCreateSchema
  .partial()
  .extend({ active: z.boolean().optional() });

export const employmentTypeParamSchema = z.enum(CONTRACT_TYPES);

export const employmentTypeConfigSchema = z.object({
  active: z.boolean().optional(),
  defaultTemplateId: z.string().trim().min(1).max(64).nullable().optional(),
  payrollApplicableDefault: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const employeeCodeSchema = z.object({
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(8)
    .regex(/^[A-Z]+$/, "Prefix may contain only letters")
    .default("EMP"),
  digits: z.number().int().min(3).max(8).default(4),
  lastManualId: z.string().trim().toUpperCase().min(1, "Last manual code is required").max(32),
  nextValue: z.number().int().min(1).max(99_999_999),
  cutoverAt: z.coerce.date(),
  approvedBy: z.string().trim().min(1, "An approver is required").max(200),
});

export const ruleCreateSchema = z.object({
  scope: z.enum(["COMPANY", "DIRECTORATE", "DEPARTMENT"]),
  scopeId: z.string().trim().min(1).max(64),
  priority: z.number().int().min(0).max(1000).default(0),
  active: z.boolean().default(true),
  caseTypes: z.array(z.enum(CASE_TYPES)).max(3).default([]),
  juniorHrUserId: z.string().trim().min(1).max(64),
  seniorHrUserId: z.string().trim().min(1).max(64),
});

export const ruleUpdateSchema = ruleCreateSchema
  .partial()
  .refine((v) => (v.scope === undefined) === (v.scopeId === undefined), {
    message: "Level and unit change together",
    path: ["scopeId"],
  });

export const resolveRuleSchema = z.object({
  entityId: z.string().trim().min(1).max(64),
  directorateId: z.string().trim().min(1).max(64).nullable().default(null),
  departmentId: z.string().trim().min(1).max(64).nullable().default(null),
  caseType: z.enum(CASE_TYPES).default("JOIN"),
});

export const emailOverrideSchema = z.object({
  subject: z.string().trim().min(1).max(300).nullable().optional(),
  body: z.string().trim().min(1).max(20_000).nullable().optional(),
  ccRecipients: z.array(z.email()).max(10).optional(),
});

export const testEmailSchema = z.object({
  recipient: z.email(),
  caseId: z.string().trim().min(1).max(64).optional(),
});

/**
 * Desk addresses and case links (core settings store, module "jml", ADR-092).
 * `null` clears the HR value, so the deployment's environment variable (if
 * any) applies again.
 */
const optionalEmail = z.email("Enter a valid email address.").max(200).nullable().optional();
const optionalUrl = z
  .url({ protocol: /^https?$/, error: "Enter a full web address starting with https://." })
  .max(500)
  .nullable()
  .optional();
export const contactSettingsSchema = z.object({
  itEmail: optionalEmail,
  proEmail: optionalEmail,
  payrollEmail: optionalEmail,
  odooUrl: optionalUrl,
  staffingFormUrl: optionalUrl,
});
export type ContactSettingsInput = z.infer<typeof contactSettingsSchema>;
