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

/** Offboarding Module 16 report filters (R1–R8): period on the last day of service. */
export const leaveReportFilterSchema = z
  .object({
    from: isoDay.optional(),
    to: isoDay.optional(),
    exitMonth: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM")
      .optional(),
    entityId: id.optional(),
    directorateId: id.optional(),
    departmentId: id.optional(),
    hrOwnerUserId: id.optional(),
    exitType: z
      .enum([
        "RESIGNATION",
        "TERMINATION",
        "CONTRACT_EXPIRY",
        "PROBATION_EXIT",
        "SUMMARY_DISMISSAL",
      ])
      .optional(),
    exitSubtype: z.enum(["PERFORMANCE", "CONDUCT", "BUSINESS", "OTHER"]).optional(),
    nationality: z.enum(["OMANI", "EXPATRIATE"]).optional(),
    employmentType: z.enum(CONTRACT_TYPES).optional(),
    status: z.enum(CASE_STATUS_VALUES).optional(),
    segment: z
      .enum(["month", "company", "directorate", "department", "role", "grade", "tenureBand"])
      .default("month"),
    detail: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
    includeFinancial: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
  })
  .refine((v) => !(v.exitMonth && (v.from || v.to)), {
    message: "Use a month OR a from/to period",
    path: ["exitMonth"],
  })
  .refine((v) => !v.exitSubtype || v.exitType === "TERMINATION", {
    message: "A subtype filters terminations only",
    path: ["exitSubtype"],
  });

export type LeaveReportFilters = z.infer<typeof leaveReportFilterSchema>;

export const exitCalendarSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export const importExitsSchema = z.object({
  csv: z.string().min(1).max(5_000_000),
  commit: z.boolean().default(false),
});
