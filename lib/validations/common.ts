import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
});

/** @public */
export const idParamSchema = z.object({
  id: z.string().min(1),
});

export const emailSchema = z.email().toLowerCase().trim();
