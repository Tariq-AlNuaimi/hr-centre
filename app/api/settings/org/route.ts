import { NextRequest } from "next/server";
import { withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { orgProfileSchema } from "@/lib/validations/settings";
import { updateOrgProfile, getOrgProfile } from "@/lib/settings";

// PUT /api/settings/org — update the org name + default candidate language (UI-SPEC
// D.10). withAdminAuth + orgId-scoped + zod + withRateLimit OUTSIDE; audited via the
// Organization row update.
export const PUT = withRateLimit(
  withAdminAuth(async (request: NextRequest, { session }) => {
    const orgId = session.user.orgId;
    if (!orgId) return err("No organization context", 400);

    const body = await request.json().catch(() => null);
    const parsed = orgProfileSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "), 422);
    }

    await updateOrgProfile(orgId, parsed.data);
    return ok(await getOrgProfile(orgId));
  }),
  { id: "settings-org", limit: 20, windowMs: 60_000 }
);
