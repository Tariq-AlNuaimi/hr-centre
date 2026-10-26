import { z } from "zod";
import { CONTRACT_TYPES } from "@/lib/validations/people";
import { isoDay } from "./config";
import { CASE_TYPES, STAGES } from "./template";

/** Case-level actions (Onboarding §3 case routes; one set for every type). */

const id = z.string().trim().min(1).max(64);

export const CASE_STATUS_VALUES = [
  "DRAFT",
  "ACTIVE",
  "AT_RISK",
  "PENDING_SETTLEMENT",
  "COMPLETED",
  "CLOSED",
  "CANCELLED",
  "ARCHIVED",
] as const;

export const caseListSchema = z.object({
  search: z.string().trim().max(120).optional(),
  caseType: z.enum(CASE_TYPES).optional(),
  /** Comma list; default = live + completed (Onboarding listCases). */
  status: z
    .string()
    .trim()
    .max(200)
    .transform((v) => v.split(",").filter(Boolean))
    .pipe(z.array(z.enum(CASE_STATUS_VALUES)).max(8))
    .optional(),
  stage: z.enum(STAGES).optional(),
  mine: z.enum(["true", "false"]).optional(),
  entityId: id.optional(),
});
export type CaseListInput = z.infer<typeof caseListSchema>;

export const startDateSchema = z.object({ plannedStartDate: isoDay });

export const actualStartSchema = z.object({ actualStartDate: isoDay });

export const cancelSchema = z.object({
  reason: z.string().trim().min(10, "Give a reason of at least 10 characters").max(1000),
});

export const ownerSchema = z.object({
  hrOwnerUserId: id,
  /** Onboarding 8.4.7 fixed: open tasks follow the new owner unless HR says otherwise. */
  moveOpenTasks: z.boolean().default(true),
});

export const legalHoldSchema = z
  .object({
    hold: z.boolean(),
    reason: z.string().trim().min(3).max(500).nullable().default(null),
  })
  .refine((v) => !v.hold || v.reason, {
    message: "A reason is required to place a legal hold",
    path: ["reason"],
  });

export const itReadinessSchema = z.object({ confirmed: z.boolean() });

export const sendWelcomeReviewSchema = z.object({ recipient: z.email().max(254) });

export const odooIdSchema = z.object({ odooId: z.string().trim().min(1).max(64) });

export const employeeCodeRecordSchema = z.object({
  employeeCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,10}[0-9]{1,10}$/, "Letters then digits, like EMP0123"),
});

export const searchSchema = z.object({ q: z.string().trim().min(2).max(120) });

export const calendarSchema = z.object({
  from: isoDay,
  to: isoDay,
  hrOwnerUserId: id.optional(),
  entityId: id.optional(),
  directorateId: id.optional(),
  departmentId: id.optional(),
  employmentType: z.enum(CONTRACT_TYPES).optional(),
  workLocation: z.string().trim().max(120).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "COMPLETED"]).optional(),
});
export type CalendarInput = z.infer<typeof calendarSchema>;

export const statutoryWatchSchema = z.object({
  mine: z.enum(["true", "false"]).optional(),
  all: z.enum(["true", "false"]).optional(),
});
