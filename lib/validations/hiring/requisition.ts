import { z } from "zod";
import { CURRENCY_CODES } from "@/lib/hiring/money";
import { POSTING_CHANNELS } from "@/lib/hiring/posting-rules";
import { REQUISITION_STATUSES } from "@/lib/hiring/requisition-rules";

/** Hiring — requisition boundary schemas (Interview Hub position / hiringRequest / positionPosting). */

const id = z.string().min(1).max(64);
const narrative = z.string().trim().max(4000);

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
const futureDate = z.coerce.date().refine((d) => {
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  return day.getTime() > startOfToday().getTime();
}, "Target close date must be in the future");

const bandOrdered = (v: { salaryBandMin?: number | null; salaryBandMax?: number | null }) =>
  v.salaryBandMin == null || v.salaryBandMax == null || v.salaryBandMin <= v.salaryBandMax;
const bandMessage = { message: "Minimum cannot exceed the maximum", path: ["salaryBandMin"] };

const requestFields = {
  title: z.string().trim().min(1, "Job title is required").max(255),
  entityId: id,
  departmentId: id,
  hiringManagerId: id,
  openings: z.number().int().min(1, "Must be at least 1").max(999),
  targetCloseDate: futureDate,
  salaryCurrency: z.enum(CURRENCY_CODES).default("OMR"),
  salaryBandMin: z.number().nonnegative().max(1_000_000),
  salaryBandMax: z.number().nonnegative().max(1_000_000),
  businessNeed: narrative.min(1, "Business need is required"),
  alternativesConsidered: narrative.min(1, "Say why this cannot be met from the existing team"),
  departmentNeedId: id.optional().nullable(),
};

/** Save draft: only the title is required, but anything supplied must be well-formed. */
const draftRequest = z
  .object({
    ...requestFields,
    entityId: id,
    departmentId: id.optional().nullable(),
    hiringManagerId: id.optional().nullable(),
    openings: requestFields.openings.optional().nullable(),
    targetCloseDate: z.coerce.date().optional().nullable(),
    salaryCurrency: requestFields.salaryCurrency,
    salaryBandMin: requestFields.salaryBandMin.optional().nullable(),
    salaryBandMax: requestFields.salaryBandMax.optional().nullable(),
    businessNeed: narrative.optional().nullable(),
    alternativesConsidered: narrative.optional().nullable(),
  })
  .refine(bandOrdered, bandMessage);

const submitRequest = z.object(requestFields).refine(bandOrdered, bandMessage);

export const createHiringRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("draft"), request: draftRequest }),
  z.object({
    mode: z.literal("submit"),
    request: submitRequest,
    note: z.string().trim().min(1, "A note to approvers is required").max(2000),
  }),
]);
export type CreateHiringRequestInput = z.infer<typeof createHiringRequestSchema>;

/** The JD-template-driven requisition form (Interview Hub `/positions/new`). */
const requisitionObject = z.object({
  title: z.string().trim().min(1).max(255),
  entityId: id,
  departmentId: id,
  description: z.string().trim().min(1, "Write the job description").max(20_000),
  competencies: z
    .array(z.string().trim().min(1).max(120))
    .min(1, "Select at least one competency")
    .max(30),
  hiringManagerId: id,
  ownerId: id.optional().nullable(),
  grade: z.string().trim().max(40).optional().nullable(),
  jdTemplateTitle: z.string().trim().max(200).optional().nullable(),
  targetCloseDate: z.coerce.date(),
  salaryCurrency: z.enum(CURRENCY_CODES).default("OMR"),
  salaryBandMin: z.number().nonnegative().max(1_000_000),
  salaryBandMax: z.number().nonnegative().max(1_000_000),
  openings: z.number().int().min(1).max(999).optional(),
  businessNeed: narrative.optional().nullable(),
  alternativesConsidered: narrative.optional().nullable(),
  hmSeesSalary: z.boolean().optional(),
});

export const createRequisitionSchema = requisitionObject
  .extend({ targetCloseDate: futureDate })
  .refine(bandOrdered, { ...bandMessage, path: ["salaryBandMax"] });

/** Partial edit: never fills create defaults; `status` is not editable here. */
export const updateRequisitionSchema = z
  .object(
    Object.fromEntries(
      Object.entries(requisitionObject.shape).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()]),
    ) as {
      [K in keyof typeof requisitionObject.shape]: z.ZodOptional<
        (typeof requisitionObject.shape)[K]
      >;
    },
  )
  .refine(bandOrdered, { ...bandMessage, path: ["salaryBandMax"] });
export type UpdateRequisitionInput = z.infer<typeof updateRequisitionSchema>;

export const statusChangeSchema = z.object({
  status: z.enum(REQUISITION_STATUSES as [string, ...string[]]),
  reason: z.string().trim().min(1, "A note is required for every status change").max(2000),
});

export const requisitionListQuerySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    status: z.enum(REQUISITION_STATUSES as [string, ...string[]]).optional(),
    jdStatus: z.enum(["DRAFT", "AWAITING_SIGNOFF", "CHANGES_REQUESTED", "APPROVED"]).optional(),
    departmentId: id.optional(),
    entityId: id.optional(),
    grade: z.string().trim().min(1).max(40).optional(),
    salaryMin: z.coerce.number().nonnegative().max(1_000_000_000).optional(),
    salaryMax: z.coerce.number().nonnegative().max(1_000_000_000).optional(),
    closeFrom: z.coerce.date().optional(),
    closeTo: z.coerce.date().optional(),
    sort: z.enum(["title", "status", "targetCloseDate", "createdAt"]).default("createdAt"),
    order: z.enum(["asc", "desc"]).default("desc"),
  })
  .refine((v) => v.salaryMin == null || v.salaryMax == null || v.salaryMin <= v.salaryMax, {
    message: "Minimum salary must be less than or equal to maximum salary",
    path: ["salaryMax"],
  });

export const jdActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SUBMIT"), comment: z.string().trim().max(2000).optional() }),
  z.object({
    action: z.literal("SIGN"),
    signatory: z.enum(["HIRING_MANAGER", "HR"]),
    comment: z.string().trim().max(2000).optional(),
  }),
  z.object({
    action: z.literal("REQUEST_CHANGES"),
    comment: z
      .string()
      .trim()
      .min(1, "Say what should change before sending the job description back")
      .max(2000),
  }),
]);

export const postingSchema = z.object({
  channel: z.enum(POSTING_CHANNELS as [string, ...string[]]),
  detail: z.string().trim().max(300, "Keep the listing note under 300 characters").optional(),
  omaniPreferred: z.boolean().optional(),
});
export const withdrawPostingSchema = z.object({
  channel: z.enum(POSTING_CHANNELS as [string, ...string[]]),
});
