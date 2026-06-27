import { z } from "zod";

// Zod contracts for Phase-8 editable settings (ADR-031, UI-SPEC D.10). Parsed at the
// API boundary. The tokens are Restricted — they are WRITE-ONLY here: the client sends
// a new token only when (re)setting one, and never receives it back (the GET returns a
// masked "is set" view). Token length mirrors the env floor (min 32).

// SSRF guard (senior-review MED-1): the AI/scoring endpoint URLs are HR_ADMIN-settable
// and the server fetches them (with the bearer token) — so reject anything but an
// http(s) URL and block the cloud-metadata link-local target (169.254.0.0/16 +
// named metadata hosts). We deliberately do NOT block private ranges generally: the
// scoring/LLM gateway is legitimately an internal host (http://scoring.internal,
// http://localhost:8000 per lib/scoring.ts). A compromised admin repointing the
// endpoint is the residual, accepted ADR-031 trade-off — mitigated by HR_ADMIN-only +
// the audited URL change, not by validation.
const METADATA_HOSTS = new Set(["metadata", "metadata.google.internal"]);
function isSafeEndpointUrl(u: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (host.startsWith("169.254.") || host === "[fe80::]" || host.startsWith("fe80:")) return false;
  if (METADATA_HOSTS.has(host)) return false;
  return true;
}

const urlOrEmpty = z.union([
  z.string().trim().url().refine(isSafeEndpointUrl, {
    message: "Endpoint URL must be an http(s) address and not a metadata/link-local host",
  }),
  z.literal(""),
]);

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

// Org profile (PUT /api/settings/org). Updates the Organization row directly.
export const orgProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    defaultLocale: z.enum(["en", "ar"]),
  })
  .strict();
export type OrgProfileInput = z.infer<typeof orgProfileSchema>;

// PDPL candidate erasure (POST /api/settings/erase-candidate). Soft-deletes the
// candidate's sitting (invitation → assessment → result) for the recycling-bin purge.
export const eraseCandidateSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
  })
  .strict();
export type EraseCandidateInput = z.infer<typeof eraseCandidateSchema>;
