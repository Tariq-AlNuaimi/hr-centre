import { z } from "zod";
import { isSafePublicUrl } from "./url-safety";

// Vibe Inspector — AI provider settings validation (ADR-016).

export const updateAiProviderSchema = z
  .object({
    provider: z.enum(["ANTHROPIC", "OPENAI_COMPATIBLE"]),
    // Required + must be a valid http(s) URL when provider is OPENAI_COMPATIBLE.
    baseUrl: z.string().trim().max(2048).optional().or(z.literal("")),
    model: z.string().trim().min(1).max(200),
    // Omitted/blank => keep the existing stored key.
    apiKey: z.string().max(4096).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.provider === "OPENAI_COMPATIBLE") {
      const url = val.baseUrl?.trim();
      if (!url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["baseUrl"],
          message: "Base URL is required for an OpenAI-compatible provider",
        });
        return;
      }
      // Block loopback / link-local / private ranges — the base URL receives a
      // Bearer API key, so a typo or hostile URL must not exfiltrate it or hit
      // internal/metadata endpoints (SSRF). Admin-only, but defence-in-depth.
      if (!isSafePublicUrl(url)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["baseUrl"],
          message: "Base URL must be a valid public http(s) URL (no localhost / private IPs)",
        });
      }
    }
  });

export type UpdateAiProviderInput = z.infer<typeof updateAiProviderSchema>;
