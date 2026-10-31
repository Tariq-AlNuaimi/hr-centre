import { z } from "zod";

/** Admin › Email log filters (ADR-095 follow-up). Dates are calendar days (YYYY-MM-DD). */
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD form")
  .optional();

export const emailLogQuerySchema = z.object({
  module: z
    .string()
    .trim()
    .max(20)
    .regex(/^[a-z]*$/, "Unknown module")
    .optional(),
  status: z.enum(["QUEUED", "SENT", "FAILED", "CANCELLED"]).optional(),
  from: day,
  to: day,
  page: z.string().optional(),
  pageSize: z.string().optional(),
});
