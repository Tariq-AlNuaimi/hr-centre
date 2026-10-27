import { z } from "zod";
import { checkBaseUrl } from "./ai-egress";

/** Boundary schemas for hiring AI and Hiring settings (Interview Hub `settings-ai`, `scoring-weights`). */

const AI_KINDS = ["jd", "fit", "transcript"] as const;
export type AiKind = (typeof AI_KINDS)[number];

export const insightRunSchema = z.object({
  kind: z.enum(AI_KINDS),
  entityId: z.string().min(1).max(64),
  /** transcript only: analyse this text instead of the stored transcript. */
  transcript: z.string().max(60_000).optional(),
});

export const insightQuerySchema = z.object({
  kind: z.enum(AI_KINDS),
  entityId: z.string().min(1).max(64),
});

export const aiProviderSchema = z.object({
  provider: z.enum(["anthropic", "openai"]),
  baseUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || checkBaseUrl(v) === null, {
      error: (i) => `Base URL rejected: ${checkBaseUrl(String(i.input))}`,
    }),
  model: z.string().trim().min(1).max(200),
  /** Blank keeps the stored key; `clearKey` removes it. */
  apiKey: z.string().trim().max(400).optional(),
  clearKey: z.boolean().optional(),
  pdfVision: z.boolean().optional(),
});
export type AiProviderInput = z.infer<typeof aiProviderSchema>;

export const aiLimitsSchema = z.object({
  killSwitch: z.boolean(),
  dailyTokenCap: z.number().int().nonnegative().max(1_000_000_000),
  dailySpendCap: z.number().nonnegative().max(10_000_000),
  timeoutMs: z.number().int().min(1000).max(300_000),
  pricePer1kIn: z.number().nonnegative().max(1000),
  pricePer1kOut: z.number().nonnegative().max(1000),
});
export type AiLimitsInput = z.infer<typeof aiLimitsSchema>;

const pct = z.number().int().min(0).max(100);
export const scoringWeightsSchema = z
  .object({ skills: pct, experience: pct, education: pct, culture: pct, language: pct })
  .refine((w) => w.skills + w.experience + w.education + w.culture + w.language === 100, {
    message: "Weights must add up to 100%",
  });
export type ScoringWeights = z.infer<typeof scoringWeightsSchema>;
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  skills: 40,
  experience: 30,
  education: 10,
  culture: 10,
  language: 10,
};

const panelModeSchema = z.object({ mode: z.enum(["blind", "assisted", "off"]) });

const budgetEntrySchema = z.object({
  fiscalYear: z.string().trim().min(1).max(20),
  amountOMR: z.number().nonnegative().max(1_000_000_000),
  setBy: z.string().trim().min(1).max(120),
  setOn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-07-03"),
});
export const budgetEnvelopeSchema = z.object({
  entities: z.record(z.string().min(1).max(20), budgetEntrySchema),
});

/** A CV upload is multipart; this bounds the file itself. */
export const CV_MAX_BYTES = 8 * 1024 * 1024;

/** Same set and order as `APPROVAL_ROLES` (a contract test keeps them equal). */
export const APPROVAL_ROLE_VALUES = [
  "HR_MANAGER",
  "HR_SPECIALIST",
  "HIRING_MANAGER",
  "PANELIST",
  "DEPARTMENT_HEAD",
  "DIRECTOR",
  "OPERATIONS_MANAGER",
  "OPERATIONS_DIRECTOR",
  "COO",
  "CEO",
] as const;
const approvalRole = z.enum(APPROVAL_ROLE_VALUES);

/** One section of Hiring settings per save, so a stale form cannot overwrite another section. */
export const generalSettingsSchema = z.discriminatedUnion("section", [
  z.object({ section: z.literal("weights"), value: scoringWeightsSchema }),
  z.object({ section: z.literal("panel"), value: panelModeSchema }),
  z.object({ section: z.literal("budget"), value: budgetEnvelopeSchema }),
  z.object({
    section: z.literal("tawteen"),
    value: z.object({
      targets: z.record(z.string().min(1).max(20), z.number().int().min(0).max(100)),
    }),
  }),
  z.object({
    section: z.literal("approvals"),
    value: z.object({
      chains: z.record(z.string().min(1).max(20), z.array(approvalRole).min(1).max(10)),
      cooThreshold: z.number().nonnegative().max(1_000_000),
    }),
  }),
]);
export type GeneralSettingsInput = z.infer<typeof generalSettingsSchema>;

export const parseModeSchema = z.enum(["cv", "jd", "competencies"]);
export const aiScreenChunkSchema = z.object({
  skip: z.array(z.string().min(1).max(64)).max(500).default([]),
});
