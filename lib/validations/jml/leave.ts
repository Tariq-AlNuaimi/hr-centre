import { z } from "zod";
import { isoDay } from "./config";

/**
 * Leaver boundaries — HR Offboarding `lib/validations/offboarding/*` on the
 * core record: the employee is picked (not typed), the line manager comes from
 * the record (D13), dates are plausible-year ISO days.
 */

const id = z.string().trim().min(1).max(64);
const ref = z.string().trim().max(255).nullable();

const EXIT_TYPES = [
  "RESIGNATION",
  "TERMINATION",
  "CONTRACT_EXPIRY",
  "PROBATION_EXIT",
  "SUMMARY_DISMISSAL",
] as const;
const EXIT_SUBTYPES = ["PERFORMANCE", "CONDUCT", "BUSINESS", "OTHER"] as const;
const NATIONALITY_BRANCHES = ["OMANI", "EXPATRIATE"] as const;
const APPROVAL_TYPE_VALUES = [
  "EXIT_CONFIRMATION",
  "TERMINATION_AUTHORISATION",
  "EARLY_RELEASE_VIA_LEAVE",
  "BACKFILL_DECISION",
  "FINAL_SETTLEMENT_APPROVAL",
] as const;
const ACCESS_DOMAIN_VALUES = [
  "IDENTITY",
  "COMMUNICATION",
  "NETWORK",
  "CODE_AND_INFRASTRUCTURE",
  "DATA",
  "THIRD_PARTY_AND_SAAS",
  "SHARED_CREDENTIALS",
  "PHYSICAL",
  "EXTERNAL_FACING",
] as const;

const dates = {
  noticeStartDate: isoDay,
  noticePeriodDays: z.number().int().min(0).max(365),
  noticePeriodOverrideReason: z.string().trim().max(1000).nullable().default(null),
  lastPhysicalWorkingDay: isoDay.nullable().default(null),
  lastDayOfService: isoDay.nullable().default(null),
  departureDate: isoDay.nullable().default(null),
};

/**
 * QA D-04: the exit dates must run in order. A last day of service (or last
 * physical working day) before the notice starts was accepted, and the payment
 * deadline was computed from it.
 */
function datesInOrder(
  v: { noticeStartDate: Date; lastPhysicalWorkingDay: Date | null; lastDayOfService: Date | null },
  ctx: z.RefinementCtx,
) {
  const start = v.noticeStartDate.getTime();
  if (v.lastDayOfService && v.lastDayOfService.getTime() < start) {
    ctx.addIssue({
      code: "custom",
      path: ["lastDayOfService"],
      message: "The last day of service cannot be before the notice start date.",
    });
  }
  if (v.lastPhysicalWorkingDay && v.lastPhysicalWorkingDay.getTime() < start) {
    ctx.addIssue({
      code: "custom",
      path: ["lastPhysicalWorkingDay"],
      message: "The last working day cannot be before the notice start date.",
    });
  }
  if (
    v.lastPhysicalWorkingDay &&
    v.lastDayOfService &&
    v.lastPhysicalWorkingDay.getTime() > v.lastDayOfService.getTime()
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["lastPhysicalWorkingDay"],
      message: "The last working day cannot be after the last day of service.",
    });
  }
}

export const createExitSchema = z
  .object({
    employeeId: id,
    exitType: z.enum(EXIT_TYPES),
    exitSubtype: z.enum(EXIT_SUBTYPES).nullable().default(null),
    /** Defaults from the employee's nationality; required when none is on file. */
    nationality: z.enum(NATIONALITY_BRANCHES).nullable().default(null),
    ...dates,
    settlementApplicable: z.boolean().default(true),
    visaSupportApplicable: z.boolean().default(false),
    docRefPerformanceHistory: ref.default(null),
    docRefWrittenGrounds: ref.default(null),
    docRefLegalReview: ref.default(null),
  })
  .superRefine(datesInOrder);
export type CreateExitInput = z.infer<typeof createExitSchema>;

/** Edits outside the date model (Offboarding updateExitCaseSchema + backfill/rehire). */
export const updateExitSchema = z.object({
  expectedVersion: z.number().int().min(0),
  gradeAtExit: z.string().trim().max(64).nullable().optional(),
  positionClassificationId: id.nullable().optional(),
  settlementApplicable: z.boolean().optional(),
  visaSupportApplicable: z.boolean().optional(),
  docRefPerformanceHistory: ref.optional(),
  docRefWrittenGrounds: ref.optional(),
  docRefLegalReview: ref.optional(),
  backfillDecision: z.enum(["BACKFILL", "RELEASE", "DEFERRED", "PENDING"]).optional(),
  backfillApprovalRef: z.string().trim().max(255).nullable().optional(),
  rehireEligible: z.enum(["YES", "CONDITIONAL", "NO"]).nullable().optional(),
});
export type UpdateExitInput = z.infer<typeof updateExitSchema>;

/** The date model, the type and the branch (Offboarding PUT …/dates; on a draft too). */
export const exitDatesSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    exitType: z.enum(EXIT_TYPES),
    exitSubtype: z.enum(EXIT_SUBTYPES).nullable().default(null),
    nationality: z.enum(NATIONALITY_BRANCHES),
    ...dates,
    earlyReleaseApproved: z.boolean().optional(),
    changeReason: z.string().trim().max(1000).nullable().default(null),
  })
  .superRefine(datesInOrder);
export type ExitDatesInput = z.infer<typeof exitDatesSchema>;

export const cancelExitSchema = z.object({
  reason: z.string().trim().min(1, "A cancellation reason is required (AC-2.1)").max(2000),
  expectedVersion: z.number().int().min(0),
});

export const requestApprovalSchema = z.object({ approvalType: z.enum(APPROVAL_TYPE_VALUES) });

export const decideApprovalSchema = z.object({
  status: z.enum(["GRANTED", "REJECTED"]),
  decisionDate: isoDay,
  reference: z.string().trim().max(500).nullable().default(null),
  comments: z.string().trim().max(2000).nullable().default(null),
  delegateUsed: z.boolean().default(false),
  secondLevelUsed: z.boolean().default(false),
});

export const authoritySchema = z.object({
  approvalType: z.enum(APPROVAL_TYPE_VALUES),
  holderLabel: z.string().trim().min(2).max(120),
  delegateEmployeeId: id.nullable(),
  secondLevelDelegateEmployeeId: id.nullable().default(null),
  active: z.boolean().default(true),
});

export const gateSchema = z
  .object({
    gateId: z.string().regex(/^C(1[01]?|[2-9])$/, "A gate id C1–C11"),
    satisfied: z.boolean().optional(),
    reference: z.string().trim().max(500).nullable().default(null),
    override: z.boolean().default(false),
    overrideReason: z.string().trim().max(1000).nullable().default(null),
  })
  .refine((v) => v.override || v.satisfied !== undefined, {
    message: "Say whether the gate is satisfied, or override it",
    path: ["satisfied"],
  });

export const addAssetSchema = z.object({
  assetTypeId: id,
  description: z.string().trim().max(500).nullable().default(null),
  identifier: z.string().trim().max(200).nullable().default(null),
  issuedDate: isoDay.nullable().default(null),
  conditionAtIssue: z.string().trim().max(500).nullable().default(null),
  returnDueDate: isoDay.nullable().default(null),
});

export const assetReturnSchema = z.object({
  returnedDate: isoDay,
  conditionAtReturn: z.string().trim().min(1).max(500),
  deductionApplicable: z.boolean().default(false),
  deductionAmount: z
    .string()
    .trim()
    .regex(/^\d{1,7}(\.\d{1,3})?$/, "An amount like 120 or 120.500")
    .nullable()
    .default(null),
});

export const assetWriteOffSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const addAccessSchema = z.object({
  domain: z.enum(ACCESS_DOMAIN_VALUES),
  systemName: z.string().trim().min(1).max(200),
  accessLevel: z.string().trim().max(200).nullable().default(null),
  sharedCredential: z.boolean().default(false),
  rotationRequired: z.boolean().default(false),
  dueDate: isoDay.nullable().default(null),
});

export const confirmAccessSchema = z.object({
  confirmingParty: z.string().trim().max(200).nullable().default(null),
  confirmedDate: isoDay.nullable().default(null),
  reference: z.string().trim().max(500).nullable().default(null),
  coveredByDisablementOf: z.string().trim().max(200).nullable().default(null),
});

export const rekeySchema = z.object({
  reason: z.string().trim().min(3).max(1000),
  dispositions: z
    .array(
      z.discriminatedUnion("outcome", [
        z.object({
          code: z.string().max(20),
          outcome: z.literal("COMPLETED"),
          completedAt: isoDay,
        }),
        z.object({
          code: z.string().max(20),
          outcome: z.literal("NOT_APPLICABLE"),
          reason: z.string().trim().min(3).max(1000),
        }),
        z.object({ code: z.string().max(20), outcome: z.literal("STILL_OUTSTANDING") }),
      ]),
    )
    .max(200),
});

export const assetTypeSchema = z.object({
  id: id.optional(),
  label: z.string().trim().min(2).max(120),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

export const accessChecklistSchema = z.object({
  id: id.optional(),
  domain: z.enum(ACCESS_DOMAIN_VALUES),
  label: z.string().trim().min(2).max(200),
  sharedCredential: z.boolean().default(false),
  rotationRequired: z.boolean().default(false),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

export const overridesQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "A month like 2026-10"),
});

// --- S6: settlement, interview, closure --------------------------------------

const omr = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, "An amount like 120 or 120.500");

export const calculateSettlementSchema = z.object({
  leaveBalanceDays: z.number().min(-365).max(365),
  outstandingSalaryAmount: z.number().min(0).max(10_000_000).default(0),
});

export const settlementLineSchema = z
  .object({
    lineType: z.enum(["ADDITION", "DEDUCTION"]),
    deductionType: z
      .enum([
        "VISA_COST_RECOVERY",
        "MEDICAL_INSURANCE",
        "NEGATIVE_LEAVE_BALANCE",
        "NOTICE_SHORTFALL",
        "UNRETURNED_OR_DAMAGED_ASSET",
        "OUTSTANDING_ADVANCE_OR_LOAN",
      ])
      .nullable()
      .default(null),
    description: z.string().trim().min(2).max(300),
    lineAmount: omr,
    reasonCode: z.string().trim().min(1).max(60),
    documentaryReference: z.string().trim().min(1).max(300),
    authorisedById: id,
    assetId: id.nullable().default(null),
  })
  .refine((v) => (v.lineType === "DEDUCTION") === (v.deductionType !== null), {
    message: "A deduction names its type; an addition does not",
    path: ["deductionType"],
  });

export const approveSettlementSchema = z.object({
  signatureReference: z.string().trim().max(300).nullable().default(null),
});

export const paymentSchema = z.object({
  paymentDate: isoDay,
  paymentReference: z.string().trim().min(1).max(200),
});

const REASON_LEVEL1 = [
  "VOLUNTARY_ATTRACTED_AWAY",
  "VOLUNTARY_DISSATISFACTION",
  "VOLUNTARY_PERSONAL",
  "INVOLUNTARY_PERFORMANCE",
  "INVOLUNTARY_CONDUCT",
  "INVOLUNTARY_BUSINESS",
  "CONTRACT",
] as const;

export const interviewSchema = z.object({
  conducted: z.enum(["CONDUCTED", "DECLINED"]),
  primaryL1: z.enum(REASON_LEVEL1),
  primaryL2Code: z.string().regex(/^[A-Z]{3}-\d{2}$/, "A code like VAA-01"),
  secondaryL2Code: z
    .string()
    .regex(/^[A-Z]{3}-\d{2}$/)
    .nullable()
    .default(null),
  narrative: z.string().max(10_000).nullable().default(null),
  destinationType: z
    .enum([
      "COMPETITOR",
      "SAME_SECTOR",
      "OTHER_SECTOR",
      "PUBLIC_SECTOR",
      "OVERSEAS",
      "STUDY",
      "NOT_DISCLOSED",
    ])
    .nullable()
    .default(null),
  retentionAttempted: z.boolean().nullable().default(null),
  counterOfferMade: z.boolean().nullable().default(null),
  recommendScore: z.number().int().min(1).max(5),
  returnScore: z.number().int().min(1).max(5),
  interviewedAt: isoDay.nullable().default(null),
});

const PREVENTION_FACTOR_VALUES = [
  "COMPENSATION",
  "CAREER_PROGRESSION",
  "MANAGER_RELATIONSHIP",
  "WORKLOAD_OR_BURNOUT",
  "RECOGNITION",
  "ROLE_CONTENT",
  "LEARNING_AND_DEVELOPMENT",
  "WORK_LIFE_BALANCE",
  "ORGANISATIONAL_DIRECTION",
  "OTHER",
] as const;

export const assessmentSchema = z.object({
  regrettable: z.enum(["REGRETTABLE", "NON_REGRETTABLE", "NEUTRAL"]).nullable(),
  preventable: z.enum(["PREVENTABLE", "NOT_PREVENTABLE", "UNCLEAR"]).nullable(),
  preventionFactor: z.enum(PREVENTION_FACTOR_VALUES).nullable().default(null),
});

export const closeExitSchema = z.object({ expectedVersion: z.number().int().min(0) });

export const reasonCodeSchema = z.object({
  id: id.optional(),
  level1: z.enum(REASON_LEVEL1),
  code: z.string().regex(/^[A-Z]{3}-\d{2}$/, "A code like VAA-07"),
  label: z.string().trim().min(2).max(120),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

// --- S6b: documents ------------------------------------------------------------

export const DOCUMENT_TYPE_VALUES = [
  "ACCEPTANCE_OF_RESIGNATION",
  "TERMINATION_NOTIFICATION",
  "NON_RENEWAL_NOTIFICATION",
  "BANK_TERMINATION_NOTICE",
  "REPATRIATION_TICKET_REQUEST",
  "IT_ACCESS_REVOCATION_INSTRUCTION",
  "FINAL_SETTLEMENT_WORKSHEET",
  "SETTLEMENT_TRANSMITTAL_TO_FINANCE",
  "CERTIFICATE_OF_SERVICE",
] as const;

export const uploadTemplateSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPE_VALUES),
  name: z.string().trim().min(2).max(120),
  language: z.enum(["en", "ar"]).default("en"),
  /** The .docx as base64 (≤ 2 MB decoded — the engine re-checks). */
  base64: z
    .string()
    .max(2_900_000, "The template is larger than 2 MB")
    .regex(/^[A-Za-z0-9+/=\s]+$/, "Not a base64 file"),
});

export const generateDocumentSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPE_VALUES),
  useCurrent: z.boolean().default(false),
  reason: z.string().trim().max(500).nullable().default(null),
});
