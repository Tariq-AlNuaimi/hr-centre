import { NextRequest } from "next/server";
import { withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { aiSettingsSchema } from "@/lib/validations/settings";
import { applyAiSettings, getAiSettingsView } from "@/lib/settings";

// PUT /api/settings/ai — set the editable AI/scoring config (ADR-031, UI-SPEC D.10).
// withAdminAuth (HR_ADMIN) + orgId-scoped + zod + withRateLimit OUTSIDE. The endpoint
// TOKENS are WRITE-ONLY: applied when a non-empty value is sent, encrypted at rest,
// and NEVER returned — the response is the masked view (URL/model + "token is set").
export const PUT = withRateLimit(
  withAdminAuth(async (request: NextRequest, { session }) => {
    const orgId = session.user.orgId;
    if (!orgId) return err("No organization context", 400);

    const body = await request.json().catch(() => null);
    const parsed = aiSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "), 422);
    }

    await applyAiSettings(orgId, parsed.data, session.user.id);
    return ok(await getAiSettingsView(orgId));
  }),
  { id: "settings-ai", limit: 20, windowMs: 60_000 }
);
