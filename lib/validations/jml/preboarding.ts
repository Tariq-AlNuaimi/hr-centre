import { z } from "zod";
import { DOCUMENT_ANSWERS } from "@/lib/jml/preboarding/rules";

/** P2-4 — the joiner's preboarding form (public, token-authorised). */
export const preboardingTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Not found.");

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it to ${max} characters or fewer.`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const answer = z.enum(DOCUMENT_ANSWERS).optional();

/** Mirrors PREBOARDING_DOCUMENTS; `.strict()` refuses any other key. */
export const preboardingSubmitSchema = z
  .object({
    introSentence: text(500),
    hobbies: text(500),
    documents: z
      .object({
        CIVIL_ID: answer,
        PASSPORT: answer,
        QUALIFICATION: answer,
        ROP_CLEARANCE: answer,
      })
      .strict()
      .default({}),
  })
  .strict();

export type PreboardingSubmit = z.infer<typeof preboardingSubmitSchema>;

/** P2-4 — HR issues a link; `email` also sends it to the joiner's personal address. */
export const preboardingIssueSchema = z.object({ email: z.boolean().default(false) }).strict();
