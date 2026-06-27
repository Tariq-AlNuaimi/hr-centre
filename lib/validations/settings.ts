import { z } from "zod";

// Zod contracts for Phase-8 editable settings (ADR-031, UI-SPEC D.10). Parsed at the
// API boundary. The tokens are Restricted — they are WRITE-ONLY here: the client sends
// a new token only when (re)setting one, and never receives it back (the GET returns a
// masked "is set" view). Token length mirrors the env floor (min 32).

const urlOrEmpty = z.union([z.string().trim().url(), z.literal("")]);

// AI / scoring endpoint config (PUT /api/settings/ai). Every field is optional so the
// form can patch a subset; an empty URL string clears that setting (falls back to env).
// A token is applied ONLY when a non-empty string is sent; `clear*Token` explicitly
// removes a stored token (so a blank submit never silently wipes a configured secret).
export const aiSettingsSchema = z
  .object({
    llmUrl: urlOrEmpty.optional(),
    llmModel: z.string().trim().max(100).optional(),
    llmToken: z.string().trim().min(32).max(500).optional(),
    clearLlmToken: z.boolean().optional(),
    scoringUrl: urlOrEmpty.optional(),
    scoringToken: z.string().trim().min(32).max(500).optional(),
    clearScoringToken: z.boolean().optional(),
  })
  .strict();
export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;
