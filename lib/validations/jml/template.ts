import { z } from "zod";

/**
 * Checklist templates (Onboarding `onboarding-template.ts` ∪ Offboarding
 * TaskTemplate admin) — boundary schemas. Compensation is never a criterion or
 * a condition (`.strict()` on both, Onboarding ADR-067 reasoning).
 */

export const CASE_TYPES = ["JOIN", "MOVE", "LEAVE"] as const;
export const CHANGE_TYPES = [
  "INTERNSHIP_TO_TRAINING",
  "INTERNSHIP_TO_EMPLOYMENT",
  "TRAINING_TO_EMPLOYMENT",
  "DEPARTMENT_TRANSFER",
] as const;
export const STAGES = [
  "PREBOARDING",
  "FIRST_DAY",
  "FIRST_WEEK",
  "STAGE_1_RESIGNATION",
  "STAGE_2_IMMEDIATE",
  "STAGE_3_NOTICE_HANDOVER",
  "STAGE_4_SETTLEMENT",
] as const;
const DATE_BASES = [
  "START_DATE",
  "EFFECTIVE_DATE",
  "NOTICE_START",
  "LAST_PHYSICAL_WORKING_DAY",
  "LAST_DAY_OF_SERVICE",
  "DEPARTURE_DATE",
] as const;
const OFFSET_UNITS = ["CALENDAR_DAYS", "WORKING_DAYS"] as const;
export const COMPLIANCE_CATEGORIES = ["ROP_CLEARANCE", "VISA", "MOL", "OTHER"] as const;
const EXIT_TYPES = [
  "RESIGNATION",
  "TERMINATION",
  "CONTRACT_EXPIRY",
  "PROBATION_EXIT",
  "SUMMARY_DISMISSAL",
] as const;
const ASSIGNEE_ROLES = ["HR", "LINE_MANAGER", "IT", "FINANCE"] as const;
const NATIONALITY_SCOPES = ["OMANI", "EXPATRIATE", "ANY"] as const;
const EMPLOYMENT_SCOPES = ["FULL", "LIGHT", "ANY"] as const;

const value = z.string().trim().min(1).max(120);
const rule = z
  .object({
    in: z.array(value).min(1).max(20).optional(),
    notIn: z.array(value).min(1).max(20).optional(),
  })
  .strict();

export const conditionsSchema = z
  .object({
    companyId: rule.optional(),
    employmentType: rule.optional(),
    contractTypeId: rule.optional(),
    nationality: rule.optional(),
    workLocation: rule.optional(),
    payrollApplicable: rule.optional(),
    laptopRequired: rule.optional(),
    accessCardRequired: rule.optional(),
  })
  .strict()
  .default({});

const criteriaSchema = z
  .object({
    companyId: z.string().trim().min(1).max(64).optional(),
    employmentType: z.string().trim().min(1).max(64).optional(),
    contractTypeId: z.string().trim().min(1).max(64).optional(),
    nationality: z.string().trim().min(1).max(80).optional(),
    workLocation: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .default({});

const templateTaskSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9][A-Z0-9-]{0,15}$/, "Use capitals, digits and dashes, e.g. S1-01"),
    name: z.string().trim().min(1).max(500),
    stage: z.enum(STAGES),
    sortOrder: z.number().int().min(0).max(9999).default(0),
    dateBasis: z.enum(DATE_BASES),
    offsetDays: z.number().int().min(-365).max(365).default(0),
    offsetUnit: z.enum(OFFSET_UNITS),
    mandatory: z.boolean().default(true),
    blocking: z.boolean().default(false),
    confirmationRequired: z.boolean().default(false),
    defaultConfirmingParty: z.string().trim().max(120).nullable().default(null),
    reversalFlag: z.boolean().default(false),
    dependsOnCodes: z.array(z.string().trim().min(1).max(16)).max(20).default([]),
    statutory: z.boolean().default(false),
    complianceCategory: z.enum(COMPLIANCE_CATEGORIES).nullable().default(null),
    conditions: conditionsSchema,
    /** Task routing (docs/blueprints/jml-task-routing.md). */
    assigneeRole: z.enum(ASSIGNEE_ROLES).default("HR"),
    appliesToExitTypes: z.array(z.enum(EXIT_TYPES)).max(5).default([]),
    appliesToNationality: z.enum(NATIONALITY_SCOPES).default("ANY"),
    appliesToSettlement: z.boolean().nullable().default(null),
  })
  .refine((t) => !t.statutory || t.complianceCategory !== null, {
    message: "A statutory task needs a compliance category",
    path: ["complianceCategory"],
  });

const tasks = z
  .array(templateTaskSchema)
  .min(1, "A template needs at least one task")
  .max(200)
  .refine((list) => new Set(list.map((t) => t.code)).size === list.length, {
    message: "Task codes must be unique within a template",
  });

const STAGES_BY_TYPE: Record<(typeof CASE_TYPES)[number], readonly string[]> = {
  JOIN: ["PREBOARDING", "FIRST_DAY", "FIRST_WEEK"],
  MOVE: ["PREBOARDING", "FIRST_DAY", "FIRST_WEEK"],
  LEAVE: [
    "STAGE_1_RESIGNATION",
    "STAGE_2_IMMEDIATE",
    "STAGE_3_NOTICE_HANDOVER",
    "STAGE_4_SETTLEMENT",
  ],
};
const BASES_BY_TYPE: Record<(typeof CASE_TYPES)[number], readonly string[]> = {
  JOIN: ["START_DATE"],
  MOVE: ["EFFECTIVE_DATE"],
  LEAVE: ["NOTICE_START", "LAST_PHYSICAL_WORKING_DAY", "LAST_DAY_OF_SERVICE", "DEPARTURE_DATE"],
};

const templateBody = z.object({
  name: z.string().trim().min(1).max(120),
  active: z.boolean().default(true),
  caseType: z.enum(CASE_TYPES),
  changeType: z.enum(CHANGE_TYPES).nullable().default(null),
  criteria: criteriaSchema,
  employmentScope: z.enum(EMPLOYMENT_SCOPES).default("ANY"),
  nationalityScope: z.enum(NATIONALITY_SCOPES).default("ANY"),
  tasks,
});

/** The case-type shape rules (Onboarding DB CHECK + per-type stages and bases), or null. */
export function templateShapeProblem(t: {
  caseType: (typeof CASE_TYPES)[number];
  changeType: string | null;
  tasks: ReadonlyArray<{ stage: string; dateBasis: string; code: string }>;
}): string | null {
  if (t.caseType === "MOVE" && !t.changeType) {
    return "changeType: an internal change template needs a change type";
  }
  if (t.caseType !== "MOVE" && t.changeType) {
    return "changeType: only internal change templates have a change type";
  }
  for (const task of t.tasks) {
    if (!STAGES_BY_TYPE[t.caseType].includes(task.stage)) {
      return `tasks: ${task.code} — that stage does not belong to this case type`;
    }
    if (!BASES_BY_TYPE[t.caseType].includes(task.dateBasis)) {
      return `tasks: ${task.code} — that date basis does not belong to this case type`;
    }
  }
  return null;
}

export const createTemplateSchema = templateBody.superRefine((t, ctx) => {
  const problem = templateShapeProblem(t);
  if (problem) ctx.addIssue({ code: "custom", message: problem });
});

/** Any definition change cuts a new version; `active` alone toggles in place. */
export const updateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  active: z.boolean().optional(),
  criteria: criteriaSchema.optional(),
  employmentScope: z.enum(EMPLOYMENT_SCOPES).optional(),
  nationalityScope: z.enum(NATIONALITY_SCOPES).optional(),
  changeType: z.enum(CHANGE_TYPES).nullable().optional(),
  tasks: tasks.optional(),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type TemplateTaskInput = z.infer<typeof templateTaskSchema>;
