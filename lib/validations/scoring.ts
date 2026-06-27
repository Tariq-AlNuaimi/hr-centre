import { z } from "zod";

/**
 * Contract for the Python scoring microservice (services/scoring), mirrored as
 * zod so the Next app validates BOTH what it sends and what it gets back at the
 * trust boundary (the service is a separate process reachable via
 * SCORING_SERVICE_URL). Field names + the domain/facet identifiers match the
 * Prisma schema (`Big5Domain`, `AssessmentItemBank.facet`) so a returned score
 * joins straight onto an item-bank row. See ARCHITECTURE §6/§12.2.
 */

export const NUM_ITEMS = 120;

// Matches the Prisma `Big5Domain` enum (kept as a literal tuple so this module
// has no dependency on the generated Prisma client).
export const big5Domains = [
  "OPENNESS",
  "CONSCIENTIOUSNESS",
  "EXTRAVERSION",
  "AGREEABLENESS",
  "NEUROTICISM",
] as const;

export const scoreBandSchema = z.enum(["low", "average", "high"]);

export const answerSchema = z.object({
  itemNumber: z.number().int().min(1).max(NUM_ITEMS),
  response: z.number().int().min(1).max(5),
});

export const scoreRequestSchema = z.object({
  answers: z
    .array(answerSchema)
    .length(NUM_ITEMS)
    .superRefine((answers, ctx) => {
      const seen = new Set(answers.map((a) => a.itemNumber));
      if (seen.size !== NUM_ITEMS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `answers must cover items 1..${NUM_ITEMS} exactly once`,
        });
      }
    }),
  // Neutral default: averages the male+female norms so hiring assessments are not
  // normed by the candidate's sex (services/scoring/README.md).
  sex: z.enum(["M", "F", "N"]).default("N"),
  age: z.number().int().min(10).max(110).default(30),
});

export const facetScoreSchema = z.object({
  facet: z.string(),
  facetNumber: z.number().int().min(1).max(6),
  raw: z.number().int(),
  percentile: z.number(),
  score: scoreBandSchema,
});

export const domainScoreSchema = z.object({
  domain: z.enum(big5Domains),
  raw: z.number().int(),
  percentile: z.number(),
  score: scoreBandSchema,
  facets: z.array(facetScoreSchema).length(6),
});

export const scoreResponseSchema = z.object({
  model: z.literal("IPIP-NEO-120"),
  deterministic: z.boolean(),
  norms: z.object({
    source: z.string(),
    via: z.string(),
    sex: z.enum(["M", "F", "N"]),
    age: z.number().int(),
  }),
  domains: z.array(domainScoreSchema).length(5),
});

// Input (pre-parse) type: sex/age are optional because the schema defaults them.
// Output type: post-parse, with defaults applied.
export type ScoreRequestInput = z.input<typeof scoreRequestSchema>;
export type ScoreRequest = z.output<typeof scoreRequestSchema>;
export type ScoreResponse = z.infer<typeof scoreResponseSchema>;
export type DomainScore = z.infer<typeof domainScoreSchema>;
export type FacetScore = z.infer<typeof facetScoreSchema>;
export type Big5Domain = (typeof big5Domains)[number];
