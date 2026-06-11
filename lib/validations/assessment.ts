import { z } from "zod";
import { isPrivateHost } from "./url-safety";

// Vibe Inspector — assessment validation (ADR-016). Boundary validation for the
// /api/assessments routes.

export const DIMENSION_VALUES = [
  "DESIGN",
  "ACCESSIBILITY",
  "PERFORMANCE",
  "FUNCTIONALITY",
  "BRD_COVERAGE",
  "SECURITY",
  "BENCHMARK",
] as const;

// Accept a host or a full URL; the capture layer normalises to https:// if needed.
const targetUrlSchema = z
  .string()
  .trim()
  .min(3)
  .max(2048)
  .refine(
    (v) => {
      const candidate = /^https?:\/\//i.test(v) ? v : `https://${v}`;
      try {
        const u = new URL(candidate);
        if (u.protocol !== "http:" && u.protocol !== "https:") return false;
        if (!u.hostname.includes(".") && u.hostname !== "localhost") return false;
        return !isPrivateHost(u.hostname);
      } catch {
        return false;
      }
    },
    { message: "Enter a valid public website URL (e.g. example.com or https://example.com)" }
  );

export const createAssessmentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  targetUrl: targetUrlSchema,
  brdText: z.string().max(50_000).default(""),
  dimensions: z
    .array(z.enum(DIMENSION_VALUES))
    .min(1, "Select at least one dimension")
    .max(DIMENSION_VALUES.length),
});

export const updateAssessmentSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  targetUrl: targetUrlSchema.optional(),
  brdText: z.string().max(50_000).optional(),
  dimensions: z.array(z.enum(DIMENSION_VALUES)).min(1).max(DIMENSION_VALUES.length).optional(),
});

export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>;
export type UpdateAssessmentInput = z.infer<typeof updateAssessmentSchema>;
