import { NextRequest } from "next/server";
import { withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { draftRoleProfileSchema } from "@/lib/validations/roleProfile";
import { draftRoleProfile, LlmError } from "@/lib/llm";
import { resolveLlmConfig } from "@/lib/settings";

// AI Role 1 — draft a target competency profile from a JD (ARCHITECTURE §4,
// UI-SPEC D.3 step 2). Admin-only + rate-limited (the only outbound LLM call; a
// flood is throttled before the work runs). Returns an UNSAVED draft for the
// wizard — nothing is persisted/approved here. When the LLM seam is unconfigured
// it returns 503 with a clear flag so the UI silently falls back to manual
// authoring (the feature is strictly additive).
const handler = withAdminAuth(async (request: NextRequest, { session }) => {
  const orgId = session.user.orgId;
  if (!orgId) return err("No organization context", 400);

  // Effective LLM config: org DB setting THEN env (ADR-031).
  const llmConfig = await resolveLlmConfig(orgId);
  if (!llmConfig.baseUrl) {
    return err("AI drafting is not configured", 503);
  }

  const body = await request.json();
  const parsed = draftRoleProfileSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }

  try {
    const draft = await draftRoleProfile(parsed.data, { config: llmConfig });
    return ok(draft);
  } catch (e) {
    if (e instanceof LlmError) {
      // Surface a generic, safe failure — the wizard offers retry / manual.
      return err("AI drafting failed — author manually or retry", 502);
    }
    throw e;
  }
});

// Rate limit OUTSIDE the auth wrapper (CLAUDE.md hard rule / no-rate-limit-inside-auth).
export const POST = withRateLimit(handler, {
  id: "role-profile-draft",
  limit: 10,
  windowMs: 60_000,
});
