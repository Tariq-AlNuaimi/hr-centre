import { z } from "zod";

// Vibe Inspector — browser engine (Browserbase) settings validation (ADR-016).

export const updateBrowserEngineSchema = z.object({
  // Browserbase project id — an identifier, required to run captures.
  projectId: z.string().trim().min(1).max(200),
  // Omitted/blank => keep the existing stored key.
  apiKey: z.string().max(4096).optional(),
});

export type UpdateBrowserEngineInput = z.infer<typeof updateBrowserEngineSchema>;
