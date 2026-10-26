import { z } from "zod";
import { CONTRACT_TYPES } from "@/lib/validations/people";
import { CASE_STATUS_VALUES } from "./case";
import { isoDay } from "./config";
import { STAGES } from "./template";

/** Onboarding §13.3 standard report filters (one schema for every report). */

const id = z.string().trim().min(1).max(64);

export const reportFilterSchema = z.object({
  from: isoDay.optional(),
  to: isoDay.optional(),
  joiningMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM")
    .optional(),
  entityId: id.optional(),
  directorateId: id.optional(),
  departmentId: id.optional(),
  hrOwnerUserId: id.optional(),
  employmentType: z.enum(CONTRACT_TYPES).optional(),
  contractTypeId: id.optional(),
  nationality: z.string().trim().max(80).optional(),
  workLocation: z.string().trim().max(120).optional(),
  stage: z.enum(STAGES).optional(),
  status: z.enum(CASE_STATUS_VALUES).optional(),
  includeSalary: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export type ReportFilters = z.infer<typeof reportFilterSchema>;
