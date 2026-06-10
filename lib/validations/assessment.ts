import { z } from "zod";

// Vibe Inspector — assessment validation (ADR-015). Boundary validation for the
// /api/assessments routes.

export const DIMENSION_VALUES = [
  "DESIGN",
  "FUNCTIONALITY",
  "BRD_COVERAGE",
  "SECURITY",
  "BENCHMARK",
] as const;

// Reject loopback / link-local / private-range hosts. Capture runs in Browserbase's
// cloud (not our infra), so this is defence-in-depth, not the only SSRF control.
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h === "0.0.0.0") return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true; // link-local (cloud metadata)
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true; // 172.16.0.0/12
  return false;
}

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
