/**
 * Pure candidate rules — Interview Hub `package-confirmation.ts`, `recusal.ts` (the pure half) and the list
 * filter bounds from `candidates.ts`. No Prisma: the routes and contract tests
 * share these.
 */

// ---------------------------------------------------------------- package

export const PAYSLIP_MONTHS_REQUESTED = 3;

export type PackageDocument = {
  kind: string;
  statedAmount: number | null;
  reviewedAt: Date | string | null;
};

/** Current package = the mean of the payslips HR has READ (never an unread claim). */
export function currentPackageFrom(documents: readonly PackageDocument[]): number | null {
  const amounts = documents
    .filter((d) => d.kind === "PAYSLIP" && d.reviewedAt != null && d.statedAmount != null)
    .map((d) => d.statedAmount as number);
  if (amounts.length === 0) return null;
  return amounts.reduce((a, b) => a + b, 0) / amounts.length;
}

export function bandMidpoint(min: number | null, max: number | null): number | null {
  if (min == null || max == null || max < min) return null;
  return (min + max) / 2;
}

export type PricingBasis = "BAND_AND_VERDICT" | "BAND_VERDICT_AND_EVIDENCE";

export function pricingBasisFor(packageStatus: string): PricingBasis {
  return packageStatus === "CONFIRMED" || packageStatus === "RECEIVED"
    ? "BAND_VERDICT_AND_EVIDENCE"
    : "BAND_AND_VERDICT";
}

export function reviewedPayslips(documents: readonly PackageDocument[]): number {
  return documents.filter((d) => d.kind === "PAYSLIP" && d.reviewedAt != null).length;
}

// ---------------------------------------------------------------- referral

/** A referrer only means something on a REFERRAL source; anything else clears it. */
export function referrerToPersist(
  source: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  return source === "REFERRAL" ? (incoming ?? null) : null;
}

// ---------------------------------------------------------------- list filters

export type InterviewCountBounds = { gte: number; lte?: number; includeZero: boolean };

/** Interview-count filter → a groupBy bound (+ "or none at all" when min ≤ 0). */
export function resolveInterviewCountBounds(
  min?: number,
  max?: number,
): InterviewCountBounds | null {
  if (min == null && max == null) return null;
  const lower = min ?? 0;
  if (lower <= 0 && max == null) return null;
  return {
    gte: Math.max(lower, 1),
    ...(max != null ? { lte: max } : {}),
    includeZero: lower <= 0,
  };
}

/** Nationality reads as Omani (the Omanisation dot on cards). */
export function isOmani(nationality: string | null | undefined): boolean {
  return /\boman/i.test(nationality ?? "");
}
