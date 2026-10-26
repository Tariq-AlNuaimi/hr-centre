import { z } from "zod";
import { COMPLIANCE_CATEGORIES, STAGES } from "./template";

export const TASK_STATUS_VALUES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "WAITING_FOR_EMPLOYEE",
  "WAITING_FOR_IT",
  "WAITING_FOR_PRO",
  "WAITING_FOR_EXTERNAL",
  "WAITING_FOR_LINE_MANAGER",
  "WAITING_FOR_FINANCE",
  "WAITING_FOR_ADMIN",
  "WAITING_FOR_MOL_COORDINATOR",
  "WAITING_FOR_APPROVAL",
  "COMPLETED",
  "NOT_APPLICABLE",
  "DELAYED",
  "CANCELLED",
] as const;

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .transform((v) => new Date(`${v}T00:00:00Z`));

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const updateTaskSchema = z.object({
  status: z.enum(TASK_STATUS_VALUES).optional(),
  delayReason: optionalText(1000),
  notApplicableReason: optionalText(1000),
  reason: optionalText(1000),
  dueDate: day.nullable().optional(),
  dueDateOverrideReason: optionalText(500),
  ownerUserId: z.string().trim().min(1).max(64).nullable().optional(),
  externalReference: optionalText(500),
  confirmingParty: optionalText(200),
  confirmationDate: day.nullable().optional(),
  expectedVersion: z.number().int().min(0).optional(),
});

export const manualTaskSchema = z.object({
  name: z.string().trim().min(1).max(500),
  stage: z.enum(STAGES),
  dueDate: day,
  mandatory: z.boolean().default(true),
  blocking: z.boolean().default(false),
  comment: z.string().trim().min(3).max(1000).nullable().default(null),
  ownerUserId: z.string().trim().min(1).max(64).nullable().default(null),
  statutory: z.boolean().default(false),
  complianceCategory: z.enum(COMPLIANCE_CATEGORIES).nullable().default(null),
  externalReference: z.string().trim().max(500).nullable().default(null),
});

export const commentSchema = z.object({ body: z.string().trim().min(1).max(4000) });
