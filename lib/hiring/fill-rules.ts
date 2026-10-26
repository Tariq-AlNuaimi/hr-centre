import type { HiringStage } from "@/generated/prisma/client";

/**
 * Seats and budget — pure (Interview Hub `requisition-fill.ts`,
 * `requisition-budget.ts`). A seat is closed by an ACCEPTED offer (or a stage at
 * or after it), never by an extended one; the requisition stays Open until the
 * last seat closes, and a seat coming back reopens it.
 */

export const SEAT_OCCUPYING_STAGES: HiringStage[] = ["OFFER_ACCEPTED", "PRE_ONBOARDING", "HIRED"];

export function occupiesSeat(stage: string | null | undefined): boolean {
  return (SEAT_OCCUPYING_STAGES as string[]).includes(stage ?? "");
}

/** Openings normalised — anything not a whole number ≥ 1 reads as 1. */
export function normalizeOpenings(openings: unknown): number {
  const n = typeof openings === "number" ? Math.trunc(openings) : Number.NaN;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export type FillState = { openings: number; filled: number; remaining: number };

export function describeFill(openingsRaw: unknown, filledRaw: number): FillState {
  const openings = normalizeOpenings(openingsRaw);
  const filled = Math.max(0, Math.trunc(filledRaw));
  return { openings, filled, remaining: Math.max(0, openings - filled) };
}

/** "1 opening" · "Opening filled" · "1 of 3 openings filled". */
export function fillLabel(f: FillState): string {
  if (f.openings === 1) return f.filled >= 1 ? "Opening filled" : "1 opening";
  return `${Math.min(f.filled, f.openings)} of ${f.openings} openings filled`;
}

/**
 * The status the seat count implies, or null to leave it alone. ON_HOLD,
 * CLOSED, DRAFT and a hand-set FILLED with spare seats are never overridden;
 * only a seat actually released reopens.
 */
export function nextFillStatus(input: {
  status: string;
  openings: unknown;
  filled: number;
  seatReleased?: boolean;
}): "FILLED" | "REOPENED" | null {
  const { remaining } = describeFill(input.openings, input.filled);
  if (remaining === 0) {
    return input.status === "OPEN" || input.status === "REOPENED" ? "FILLED" : null;
  }
  return input.status === "FILLED" && input.seatReleased ? "REOPENED" : null;
}

// --- Budget check (step 2 context; display only, never a gate) ---------------------

export type BudgetEnvelopeEntry = {
  fiscalYear: string;
  amountOMR: number;
  setBy: string;
  setOn: string;
};

export type BudgetCheck = {
  openings: number;
  annualisedOMR: number | null;
  envelope: BudgetEnvelopeEntry | null;
  remainingOMR: number | null;
  overEnvelope: boolean;
};

/** Annualised at band max = bandMax × 12 × openings (OMR); remaining = envelope − that. */
export function buildBudgetCheck(input: {
  bandMaxOMR: number | null;
  openings: unknown;
  envelope: BudgetEnvelopeEntry | null;
}): BudgetCheck {
  const openings = normalizeOpenings(input.openings);
  const annualisedOMR =
    input.bandMaxOMR === null || !Number.isFinite(input.bandMaxOMR)
      ? null
      : input.bandMaxOMR * 12 * openings;
  const remainingOMR =
    input.envelope && annualisedOMR !== null ? input.envelope.amountOMR - annualisedOMR : null;
  return {
    openings,
    annualisedOMR,
    envelope: input.envelope,
    remainingOMR,
    overEnvelope: remainingOMR !== null && remainingOMR < 0,
  };
}
