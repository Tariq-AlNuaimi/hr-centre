import { z } from "zod";
import { CANONICAL_ROUND_ORDER } from "@/lib/hiring/interview-rules";
import { HIRE_VOTES } from "@/lib/hiring/scorecard-math";

/** Hiring — interview, panel, scorecard and comparison boundary schemas. */

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().trim().max(max);
export const INTERVIEW_STATUSES = ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;

const link = z
  .union([z.literal(""), z.url("Enter a full link, starting https://")])
  .optional()
  .nullable();

export const createInterviewSchema = z.object({
  candidateId: id,
  round: z.enum(CANONICAL_ROUND_ORDER),
  scheduledDate: z.coerce.date(),
  status: z.enum(INTERVIEW_STATUSES).default("SCHEDULED"),
  location: text(255).optional().nullable(),
  meetingLink: link,
  notes: text(5000).optional().nullable(),
  panelistIds: z.array(id).min(1, "Assign at least one panelist").max(12),
});

export const updateInterviewSchema = z.object({
  round: z.enum(CANONICAL_ROUND_ORDER).optional(),
  scheduledDate: z.coerce.date().optional(),
  status: z.enum(INTERVIEW_STATUSES).optional(),
  location: text(255).optional().nullable(),
  meetingLink: link,
  notes: text(5000).optional().nullable(),
  transcript: text(100_000).optional().nullable(),
  panelistIds: z.array(id).min(1, "Assign at least one panelist").max(12).optional(),
});

export const interviewListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(INTERVIEW_STATUSES).optional(),
  search: text(120).optional(),
  requisitionId: id.optional(),
  sort: z.enum(["scheduledDate", "status", "round", "createdAt"]).default("scheduledDate"),
  order: z.enum(["asc", "desc"]).default("asc"),
});

export const calendarQuerySchema = z.object({
  requisitionId: id.optional(),
  status: z.enum(INTERVIEW_STATUSES).optional(),
});

export const panelistSchema = z.object({ userId: id });
export const confirmSchema = z.object({ confirmed: z.boolean() });

export const roundPlanSchema = z.object({
  rounds: z
    .array(
      z.object({
        round: z.enum(CANONICAL_ROUND_ORDER),
        competencies: z.array(text(120).min(1)).max(12).default([]),
        durationMinutes: z.number().int().min(5).max(480),
      }),
    )
    .max(CANONICAL_ROUND_ORDER.length)
    .refine(
      (rs) => new Set(rs.map((r) => r.round)).size === rs.length,
      "Each round kind may appear at most once in the plan.",
    ),
});

const scores = z.record(z.string().max(120), z.number().int().min(1).max(5)).default({});

/** A draft save may carry only some fields (the brief's notes autosave sends notes alone). */
export const panelScoreSchema = z.object({
  scores: z.record(z.string().max(120), z.number().int().min(1).max(5)).optional(),
  strengths: text(5000).optional(),
  concerns: text(5000).optional(),
  notes: text(5000).optional(),
  vote: z.enum(HIRE_VOTES).optional(),
  submit: z.boolean().default(false),
});

export const panelReviseSchema = panelScoreSchema.extend({
  scores,
  vote: z.enum(HIRE_VOTES),
  reason: text(2000).min(3, "A reason is required when revising after the reveal"),
});

export const createEvaluationSchema = z.object({
  interviewId: id,
  panelistId: id,
  vote: z.enum(HIRE_VOTES),
  scores,
  strengths: text(5000).optional().nullable(),
  concerns: text(5000).optional().nullable(),
  notes: text(5000).optional().nullable(),
  submitted: z.boolean().optional(),
});

export const updateEvaluationSchema = createEvaluationSchema
  .omit({ interviewId: true, panelistId: true })
  .partial();

export const evaluationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  vote: z.enum(HIRE_VOTES).optional(),
  sort: z.enum(["vote", "createdAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const comparisonActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("select-preferred"),
    candidateId: id,
    note: text(4000).min(
      20,
      "The decision note needs to say why this candidate was chosen (at least 20 characters).",
    ),
  }),
  z.object({
    action: z.literal("reject-finalist"),
    candidateId: id,
    reason: text(1000).min(3, "A rejection reason is required."),
  }),
  z.object({ action: z.literal("clear-preferred"), candidateId: id }),
]);
