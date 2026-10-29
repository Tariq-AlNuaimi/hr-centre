import { z } from "zod";

export const DOCUMENT_CATEGORIES = [
  "contract",
  "certificate",
  "letter",
  "identity",
  "other",
] as const;

/** The form fields that come with an uploaded file (ADR-098). */
export const documentUploadSchema = z.object({
  title: z.string().trim().min(1, "Give the document a title.").max(200),
  category: z.enum(DOCUMENT_CATEGORIES),
  restricted: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
