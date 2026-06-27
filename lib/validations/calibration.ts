import { z } from "zod";

// Zod contracts for Phase-7 calibration (ARCHITECTURE §7, UI-SPEC D.9). Parsed at
// the API boundary (CLAUDE.md "validate at the API boundary with zod"). The outcome
// fields mirror the OutcomeRecord model; the band-suggestion tuple mirrors the pure
// `BandSuggestion` type as a client-safe const (a "use client" report view can
// import it without dragging the generated Prisma client into the browser bundle —
// the handoff's client/server boundary trap).

// Record / correct a post-hire outcome (POST /api/calibration/outcomes). `hired` is
// the gate; the rest accrue over time, so they're optional/nullable. Ratings are
// constrained to the 1..5 scale the success math expects.
export const outcomeInputSchema = z.object({
  resultId: z.string().min(1),
  hired: z.boolean(),
  probationPassed: z.boolean().nullable().optional(),
  rating6m: z.number().int().min(1).max(5).nullable().optional(),
  rating12m: z.number().int().min(1).max(5).nullable().optional(),
  retained: z.boolean().nullable().optional(),
});
export type OutcomeInputBody = z.infer<typeof outcomeInputSchema>;

// Client-safe mirror of the advisory band-suggestion directions (lib/calibration.ts
// BandSuggestion). Order is presentation-irrelevant; used by the report view to map
// a suggestion to a label/tone.
export const BAND_SUGGESTIONS = ["hold", "raise", "lower", "insufficient"] as const;
export type BandSuggestionValue = (typeof BAND_SUGGESTIONS)[number];
