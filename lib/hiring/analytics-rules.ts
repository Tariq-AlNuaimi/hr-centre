/**
 * Pure helpers for the Hiring insights (Interview Hub `/insights`,
 * `/api/executive/*`): the funnel order, small-cell suppression for DEI (D12's
 * sibling — a bucket of fewer than five people would identify them), and
 * averages that say how many records they rest on.
 */

export const MIN_CELL = 5;
export const WITHHELD = "__withheld__";

export const FUNNEL_STAGES = [
  "NEW_APPLICATION",
  "CV_SCREENED",
  "SHORTLISTED",
  "ASSESSMENT",
  "FIRST_INTERVIEW",
  "SECOND_INTERVIEW",
  "FINAL_INTERVIEW",
  "REFERENCE_CHECK",
  "BACKGROUND_CHECK",
  "DECISION_PENDING",
  "OFFER_DRAFTED",
  "OFFER_EXTENDED",
  "OFFER_ACCEPTED",
  "PRE_ONBOARDING",
  "HIRED",
] as const;

/** Buckets under MIN_CELL merge into one "withheld" bucket; if that bucket is itself under MIN_CELL it is still shown merged (never split). */
export function suppressSmallCells(
  rows: { value: string; count: number }[],
): { value: string; count: number }[] {
  const shown = rows.filter((r) => r.count >= MIN_CELL).sort((a, b) => b.count - a.count);
  const hidden = rows.filter((r) => r.count < MIN_CELL).reduce((s, r) => s + r.count, 0);
  return hidden > 0 ? [...shown, { value: WITHHELD, count: hidden }] : shown;
}

/** Whole-day average, or null when there is nothing to average. */
export function avgDays(spansMs: number[]): number | null {
  const ok = spansMs.filter((d) => d >= 0);
  if (ok.length === 0) return null;
  return Math.round((ok.reduce((a, b) => a + b, 0) / ok.length / 86_400_000) * 10) / 10;
}

export function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

/** Accepted ÷ (accepted + declined); null with no decided offers. */
export function acceptanceRate(accepted: number, declined: number): number | null {
  return pct(accepted, accepted + declined);
}
