import { z } from "zod";
import { assessmentConfigSchema } from "@/lib/hiring/assessment-rules";
import { PIPELINE_STAGES } from "@/lib/hiring/stage-rules";

/** Hiring — candidate boundary schemas (Interview Hub candidate / candidateDocument / bulkAction). */

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  text(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const CANDIDATE_SOURCES = [
  "CAREERS_PAGE",
  "MANUAL_ENTRY",
  "LINKEDIN_PASTE",
  "AGENCY",
  "REFERRAL",
  "INTERNAL",
  "DIRECT_SOURCING",
  "TAWTEEN",
  "OTHER",
] as const;
const GENDERS = ["Male", "Female"] as const;
export const STALL_CAUSES = [
  "SCORECARDS_OUTSTANDING",
  "AWAITING_APPROVAL",
  "AWAITING_CANDIDATE",
  "AWAITING_SCHEDULING",
  "AWAITING_DOCUMENTS",
  "ROLE_ON_HOLD",
  "OTHER",
] as const;
export const DOCUMENT_KINDS = [
  "PAYSLIP",
  "BANK_STATEMENT",
  "EMPLOYMENT_CONTRACT",
  "CERTIFICATE",
  "ID_DOCUMENT",
  "OTHER",
] as const;

const PHONE = /^\+?[\d\s().-]{6,}$/;
const NEC = /^[\dA-Za-z\s-]*$/;

const candidateFields = {
  requisitionId: id.optional().nullable(),
  name: text(255).min(1, "Name is required"),
  email: z
    .union([z.literal(""), z.email("Enter a valid email address")])
    .optional()
    .nullable()
    .transform((v) => (v ? v.toLowerCase() : null)),
  phone: z
    .union([
      z.literal(""),
      z.string().trim().regex(PHONE, "Digits only — international format (+, spaces, -) allowed."),
    ])
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  nationality: optionalText(80),
  nec: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .max(64)
        .regex(NEC, "National ID may contain letters, digits, spaces and dashes only"),
    ])
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  currentEmployer: optionalText(255),
  linkedinUrl: z
    .union([z.literal(""), z.url("Enter a full link, starting https://")])
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  gender: z.enum(GENDERS).optional().nullable(),
  source: z.enum(CANDIDATE_SOURCES).default("MANUAL_ENTRY"),
  sourceAttribution: optionalText(255),
  referredById: id.optional().nullable(),
  /** Monthly OMR; comp readers only (the route drops it for anyone else). */
  salaryExpectation: z.number().min(0).max(100_000_000).optional().nullable(),
};

/** Stage is never accepted: a new candidate always starts at NEW_APPLICATION. */
export const createCandidateSchema = z.object({
  ...candidateFields,
  /** The profile read from the CV on the create screen ("Fill from CV"); create only. */
  profileData: z
    .record(z.string(), z.unknown())
    .refine((v) => JSON.stringify(v).length <= 50_000, "The CV profile is too large")
    .optional()
    .nullable(),
});
export const updateCandidateSchema = z.object(candidateFields).partial();
export type CandidateInput = z.infer<typeof createCandidateSchema>;
export type CandidateUpdate = z.infer<typeof updateCandidateSchema>;

const endOfDay = (d: Date | undefined) =>
  d ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)) : d;

export const candidateListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: text(120).optional(),
    stage: z.enum(PIPELINE_STAGES).optional(),
    source: z.enum(CANDIDATE_SOURCES).optional(),
    requisitionId: id.optional(),
    sort: z.enum(["name", "stage", "source", "overallScore", "createdAt"]).default("createdAt"),
    order: z.enum(["asc", "desc"]).default("desc"),
    grade: text(32).min(1).optional(),
    scoreMin: z.coerce.number().min(0).max(100).optional(),
    scoreMax: z.coerce.number().min(0).max(100).optional(),
    interviewCountMin: z.coerce.number().int().min(0).max(100).optional(),
    interviewCountMax: z.coerce.number().int().min(0).max(100).optional(),
    createdFrom: z.coerce.date().optional(),
    createdTo: z.coerce.date().optional().transform(endOfDay),
  })
  .refine((v) => v.scoreMin == null || v.scoreMax == null || v.scoreMin <= v.scoreMax, {
    message: "Minimum score must be less than or equal to maximum score",
    path: ["scoreMax"],
  })
  .refine(
    (v) =>
      v.interviewCountMin == null ||
      v.interviewCountMax == null ||
      v.interviewCountMin <= v.interviewCountMax,
    {
      message: "Minimum interviews must be less than or equal to maximum",
      path: ["interviewCountMax"],
    },
  )
  .refine((v) => !v.createdFrom || !v.createdTo || v.createdFrom <= v.createdTo, {
    message: "Start date must be on or before end date",
    path: ["createdTo"],
  });
export type CandidateListQuery = z.infer<typeof candidateListQuerySchema>;

export const boardQuerySchema = z.object({ requisitionId: id.optional() });

export const stageMoveSchema = z.object({
  stage: z.enum(PIPELINE_STAGES),
  reason: text(1000).optional(),
  overrideGates: z.boolean().optional(),
});

export const stallCauseSchema = z
  .object({
    cause: z.enum(STALL_CAUSES).nullable(),
    note: text(1000).optional(),
  })
  .refine((v) => v.cause !== "OTHER" || Boolean(v.note), {
    message: 'Say what the hold-up is — "Other" with no note records nothing.',
    path: ["note"],
  })
  .refine((v) => v.cause !== null || !v.note, {
    message: "Clearing the reason also clears the note",
    path: ["note"],
  });

export const BULK_ID_CAP = 500;
const candidateIds = z
  .array(id)
  .min(1, "Select at least one candidate")
  .max(BULK_ID_CAP, `A bulk action is limited to ${BULK_ID_CAP} candidates`);

export const bulkActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("stage_move"), candidateIds, stage: z.enum(PIPELINE_STAGES) }),
  z.object({ action: z.literal("export"), candidateIds }),
]);

export const candidateExportQuerySchema = z.object({
  search: text(120).optional(),
  stage: z.enum(PIPELINE_STAGES).optional(),
  requisitionId: id.optional(),
});

export const uploadDocumentFieldsSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  label: text(160).min(1, "Label the document"),
  periodMonth: z.iso.datetime().optional().nullable(),
  statedAmount: z.coerce.number().min(0).max(100_000_000).optional().nullable(),
  fromCandidate: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1" || v === "on"),
});

export const reviewDocumentSchema = z
  .object({
    reviewed: z.boolean().optional(),
    statedAmount: z.number().min(0).max(100_000_000).optional().nullable(),
    reviewNote: text(1000).optional().nullable(),
    label: text(160).min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

export const packageActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request") }),
  z.object({ action: z.literal("decline"), reason: text(1000).min(1, "Record what they said") }),
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("reopen") }),
]);

const assessmentIds = z.array(id).min(1).max(200);
export const assessmentActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("invite"),
    candidateIds: assessmentIds,
    dueAt: z.iso.datetime().optional(),
  }),
  z.object({ action: z.literal("remind"), candidateIds: assessmentIds }),
  z.object({ action: z.literal("advance"), candidateIds: assessmentIds }),
  /** D3 — Interview Hub had no way to record a result at all. */
  z.object({
    action: z.literal("record"),
    candidateId: id,
    score: z.number().int().min(0).max(100),
    percentile: z.number().int().min(0).max(100).optional().nullable(),
    interviewFocus: optionalText(500),
  }),
]);

export const assessmentPolicySchema = assessmentConfigSchema;

export const screeningActionSchema = z.object({
  action: z.enum(["shortlist", "reject"]),
  candidateIds: z.array(id).min(1).max(BULK_ID_CAP),
});

export const importCandidatesSchema = z.object({ requisitionId: id });

/** Step 14: record the handover, or retry the hand-off to JML. */
export const preboardingActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("record"),
    toUserId: id.nullable().default(null),
    note: z.string().max(4000).default(""),
  }),
  z.object({ action: z.literal("handoff") }),
]);
