import { z } from "zod";

/**
 * Hiring — the PUBLIC intake boundary (careers apply, agency submit) and the
 * agency-invite admin. D2: consent is enforced HERE, server-side — Interview
 * Hub stamped `consentAt` whether or not the box was ticked.
 */

/** Bumped when the privacy & AI-use notice text changes; stored with every application. */
export const PRIVACY_NOTICE_VERSION = "2026-10-27";

const id = z.string().min(1).max(64);

export const applySchema = z.object({
  requisitionId: id,
  name: z.string().trim().min(1, "Your name is required").max(255),
  email: z.email("A valid email is required").max(255),
  phone: z.string().trim().max(50).optional(),
  nationality: z.string().trim().max(100).optional(),
  currentEmployer: z.string().trim().max(255).optional(),
  linkedinUrl: z
    .union([z.literal(""), z.url("Enter a full link, starting https://").max(500)])
    .optional(),
  consent: z.literal(true, { error: "You must accept the privacy and AI-use notice to apply" }),
});
export type ApplyInput = z.infer<typeof applySchema>;

const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "on")
  .refine((v) => v === true, { message: "Confirm the candidate has consented to this submission" });

export const agencySubmitSchema = z.object({
  candidateName: z.string().trim().min(1, "Candidate name is required").max(255),
  candidateEmail: z.email("A valid candidate email is required").max(255),
  currentEmployer: z.string().trim().max(255).optional().or(z.literal("")),
  salaryExpectation: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v == null || v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 1_000_000), {
      message: "Salary expectation must be a number between 0 and 1,000,000",
    }),
  fitNote: z.string().trim().max(4000).optional().or(z.literal("")),
  consent: checkbox,
});
export type AgencySubmitInput = z.infer<typeof agencySubmitSchema>;

/** The raw invite token: 32 random bytes, base64url (43 chars). */
export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{40,64}$/);

export const agencyInviteCreateSchema = z.object({
  agencyName: z.string().trim().min(1, "Agency name is required").max(255),
  requisitionId: id.optional().nullable(),
  expiresInDays: z.coerce.number().int().min(1).max(90).default(14),
  maxSubmissions: z.coerce.number().int().min(1).max(200).default(20),
});

export const agencyInviteListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const careersSettingsSchema = z.object({
  dailyCapPerRequisition: z.coerce.number().int().min(0).max(100_000),
});
