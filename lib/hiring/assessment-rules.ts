import { z } from "zod";

/**
 * Aptitude-assessment policy — Interview Hub `assessment-rules.ts`, pure.
 * Results are advisory unless the policy says "hard cut-off", and even then a
 * low score HOLDS a candidate for a recorded decision; it never rejects one.
 */

export const RESULTS_USE = ["ADVISORY", "HARD_CUTOFF"] as const;

export const assessmentConfigSchema = z.object({
  name: z.string().trim().min(1, "Name the assessment.").max(200),
  resultsUse: z.enum(RESULTS_USE),
  passThreshold: z.number().int().min(0).max(100),
  validityMonths: z.number().int().min(0).max(60),
});
export type AssessmentConfig = z.infer<typeof assessmentConfigSchema>;

export const DEFAULT_ASSESSMENT_CONFIG: AssessmentConfig = {
  name: "Cognitive aptitude — abstract, numerical, verbal",
  resultsUse: "ADVISORY",
  passThreshold: 60,
  validityMonths: 12,
};

export type AssessmentStatusValue = "INVITED" | "IN_PROGRESS" | "COMPLETED" | "EXPIRED";

export type PercentileBand = "TOP_DECILE" | "ABOVE" | "BELOW" | null;

export function percentileBand(
  percentile: number | null | undefined,
  score: number | null | undefined,
  passThreshold: number,
): PercentileBand {
  if (percentile == null || Number.isNaN(percentile)) return null;
  if (percentile >= 90) return "TOP_DECILE";
  if (score == null || Number.isNaN(score)) return null;
  return score >= passThreshold ? "ABOVE" : "BELOW";
}

/** Same day-of-month `validityMonths` later (clamped to the month's end); 0 = never valid. */
export function computeValidUntil(completedAt: Date, validityMonths: number): Date | null {
  if (validityMonths <= 0) return null;
  const d = new Date(completedAt.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + validityMonths);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export type ResultLike = {
  status: AssessmentStatusValue;
  validUntil: Date | null;
  score: number | null;
};

export function isResultValid(result: ResultLike | null | undefined, now: Date): boolean {
  if (result?.status !== "COMPLETED" || result.score == null || !result.validUntil) return false;
  return result.validUntil.getTime() > now.getTime();
}

export type ReuseAction = "reuse" | "invite" | "already-pending";

/** Reuse a valid result, leave a pending invite alone, else (re-)invite. */
export function reuseDecision(
  existing: ResultLike | null | undefined,
  now: Date,
  validityMonths: number,
): { action: ReuseAction; reason: string } {
  if (isResultValid(existing, now)) {
    return {
      action: "reuse",
      reason: `Valid result on file (reusable for ${validityMonths} months) — reused instead of re-sent.`,
    };
  }
  if (existing?.status === "INVITED" || existing?.status === "IN_PROGRESS") {
    return {
      action: "already-pending",
      reason: "An invitation is already out — send a reminder rather than a new invitation.",
    };
  }
  if (existing?.status === "COMPLETED") {
    return {
      action: "invite",
      reason: `Previous result is older than ${validityMonths} months — a new assessment is sent.`,
    };
  }
  return { action: "invite", reason: "No assessment on file — an invitation is sent." };
}

export function isThresholdLocked(completedResultCount: number): boolean {
  return completedResultCount > 0;
}

export function blocksAdvance(
  score: number | null | undefined,
  config: Pick<AssessmentConfig, "resultsUse" | "passThreshold">,
): boolean {
  if (config.resultsUse !== "HARD_CUTOFF") return false;
  if (score == null || Number.isNaN(score)) return false;
  return score < config.passThreshold;
}

/** An invitation past its deadline reads as expired without a write. */
export function effectiveStatus(
  status: AssessmentStatusValue,
  dueAt: Date | null | undefined,
  now: Date,
): AssessmentStatusValue {
  if (status === "COMPLETED" || status === "EXPIRED" || !dueAt) return status;
  return dueAt.getTime() < now.getTime() ? "EXPIRED" : status;
}

export function defaultDueAt(now: Date, days = 7): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

export function advanceableCount(
  rows: readonly { status: string; score: number | null }[],
  config: Pick<AssessmentConfig, "resultsUse" | "passThreshold">,
): number {
  return rows.filter((r) => r.status === "COMPLETED" && !blocksAdvance(r.score, config)).length;
}
