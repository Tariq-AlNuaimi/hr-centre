import { NextRequest } from "next/server";
import { withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { eraseCandidateSchema } from "@/lib/validations/settings";
import { eraseCandidate } from "@/lib/services/erasure";

// POST /api/settings/erase-candidate — PDPL right-to-erasure (ARCHITECTURE §11,
// UI-SPEC D.10). Soft-deletes the candidate's sitting (invitation → assessment →
// result) for the recycling-bin purge. withAdminAuth + orgId-scoped + zod +
// withRateLimit OUTSIDE; every soft-delete is audited. A no-match email is an honest
// 404, not a silent success.
export const POST = withRateLimit(
  withAdminAuth(async (request: NextRequest, { session }) => {
    const orgId = session.user.orgId;
    if (!orgId) return err("No organization context", 400);

    const body = await request.json().catch(() => null);
    const parsed = eraseCandidateSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "), 422);
    }

    const outcome = await eraseCandidate(orgId, parsed.data.email);
    if (outcome.kind === "not-found") {
      return err("No candidate sitting found for that email", 404);
    }
    return ok({ sittings: outcome.sittings });
  }),
  { id: "settings-erase", limit: 10, windowMs: 60_000 }
);
