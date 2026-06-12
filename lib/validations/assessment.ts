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

// A role + its login secret. password/cookie are plaintext at the boundary; the
// route encrypts them before persisting and never returns them.
const credentialSchema = z.object({
  role: z.string().trim().min(1).max(60),
  username: z.string().trim().max(200).optional(),
  password: z.string().max(400).optional(),
  cookie: z.string().max(4000).optional(),
});

const authFields = {
  authMode: z.enum(["NONE", "FORM", "COOKIE"]).optional(),
  loginUrl: targetUrlSchema.optional().or(z.literal("")),
  credentials: z.array(credentialSchema).max(10).optional(),
};

// How many pages to crawl + audit (entry page + same-origin links). Capped low so a
// run fits the serverless time budget; bigger crawls want the Pro plan.
const maxPagesSchema = z.coerce.number().int().min(1).max(10);

export const createAssessmentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  targetUrl: targetUrlSchema,
  brdText: z.string().max(50_000).default(""),
  dimensions: z
    .array(z.enum(DIMENSION_VALUES))
    .min(1, "Select at least one dimension")
    .max(DIMENSION_VALUES.length),
  maxPages: maxPagesSchema.default(3),
  ...authFields,
});

export const updateAssessmentSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  targetUrl: targetUrlSchema.optional(),
  brdText: z.string().max(50_000).optional(),
  dimensions: z.array(z.enum(DIMENSION_VALUES)).min(1).max(DIMENSION_VALUES.length).optional(),
  maxPages: maxPagesSchema.optional(),
  ...authFields,
});

export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>;
export type UpdateAssessmentInput = z.infer<typeof updateAssessmentSchema>;
export type CredentialInput = z.infer<typeof credentialSchema>;
