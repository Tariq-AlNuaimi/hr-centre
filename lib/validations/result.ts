import { z } from "zod";

// Zod contracts for Phase-6 results (ARCHITECTURE §6, UI-SPEC D.7). Parsed at the
// API boundary (CLAUDE.md "validate at the API boundary with zod") and to validate
// the AI Role 2 narrative coming back across the LLM trust boundary.

// The three decision outcomes (mirrors the Prisma `DecisionOutcome` enum as a
// client-safe tuple — a "use client" decision picker can import this without
// dragging the generated Prisma client into the browser bundle, per the handoff's
// client/server boundary trap).
export const DECISION_OUTCOMES = ["ADVANCE", "HOLD", "DECLINE"] as const;
export type DecisionOutcomeValue = (typeof DECISION_OUTCOMES)[number];

// Record / change a manager decision (POST /api/results/[id]/decision). The tool
// never decides — this captures the human call (UI-SPEC D.7 §7). Note is optional,
// bounded so an oversized body can't bloat the audit trail.
export const decisionInputSchema = z.object({
  decision: z.enum(DECISION_OUTCOMES),
  note: z.string().trim().max(2000).optional().nullable(),
});
export type DecisionInput = z.infer<typeof decisionInputSchema>;

// The AI Role 2 narrative the LLM must return (ARCHITECTURE §4). Strict object so a
// model that ignores the contract (prose, a hire/no-hire recommendation in a
// different field) is rejected and the numbers still render without a narrative.
// Bounded length: a numbers-restating summary is a short paragraph, not an essay.
export const narrativeResponseSchema = z.object({
  narrative: z.string().trim().min(1).max(3000),
});
export type NarrativeResponse = z.infer<typeof narrativeResponseSchema>;
