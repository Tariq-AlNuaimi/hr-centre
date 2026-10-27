import { z } from "zod";
import { OFFER_STATUSES } from "@/lib/hiring/offer-rules";

/** Hiring — offer, approval, revision, negotiation, acceptance and close-out boundary schemas. */

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().trim().max(max);
const money = z.number().nonnegative().max(1_000_000);
const allowances = z
  .record(z.string().trim().min(1).max(40), z.number().nonnegative().max(1_000_000))
  .refine((m) => Object.keys(m).length <= 20, "At most 20 allowances");

const terms = {
  salary: money.nullable().optional(),
  allowances: allowances.nullable().optional(),
  startDate: z.coerce.date(),
  probationMonths: z.number().int().min(0).max(24).default(3),
  noticePeriod: text(100).nullable().optional(),
  contractType: text(100).nullable().optional(),
  benefits: text(500).nullable().optional(),
};

export const createOfferSchema = z.object({ candidateId: id, ...terms });

export const updateOfferSchema = z
  .object({
    ...terms,
    startDate: terms.startDate.optional(),
    probationMonths: z.number().int().min(0).max(24).optional(),
    status: z.enum(OFFER_STATUSES).optional(),
    reason: text(1000).optional(),
  })
  .partial();

export const offerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(OFFER_STATUSES).optional(),
  candidateId: id.optional(),
  sort: z.enum(["status", "startDate", "createdAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const offerDecisionSchema = z.object({
  action: z.enum(["APPROVED", "REJECTED", "SENT_BACK"]),
  comment: text(2000).optional(),
});

export const reviseOfferSchema = z
  .object({
    salary: money.nullable().optional(),
    allowances: allowances.nullable().optional(),
    startDate: z.coerce.date().optional(),
    probationMonths: z.number().int().min(0).max(24).optional(),
    noticePeriod: text(100).nullable().optional(),
    contractType: text(100).nullable().optional(),
    candidateNote: text(2000).optional(),
  })
  .refine(
    (v) => Object.entries(v).some(([k, x]) => k !== "candidateNote" && x !== undefined),
    "Change at least one term",
  );

export const negotiationNoteSchema = z.object({
  body: text(4000).min(1, "Write what was discussed"),
  discussedSalary: money.nullable().optional(),
  discussedStartDate: z.coerce.date().nullable().optional(),
  candidateConfirmed: z.boolean().optional(),
});

export const acceptanceSchema = z.object({
  joiningDate: z.coerce.date(),
  noticeDetail: text(500).nullable().optional(),
  countersignedBy: text(200).nullable().optional(),
  countersignedAt: z.coerce.date().nullable().optional(),
});

export const offerLetterTemplateSchema = z.object({ body: text(20_000).min(1) });

export const closeOutQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  requisitionId: id.optional(),
});

export const closeOutMarkSchema = z.object({ candidateIds: z.array(id).min(1).max(100) });

export const chainPreviewQuerySchema = z.object({
  candidateId: id,
  total: z.coerce.number().nonnegative().max(10_000_000).optional(),
});
