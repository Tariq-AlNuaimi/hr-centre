import { NextRequest } from "next/server";
import { withManagerAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { decisionInputSchema } from "@/lib/validations/result";
import { recordDecision } from "@/lib/services/result";

// POST /api/results/[id]/decision — id = RESULT id. Records the single CURRENT human
// decision (Advance/Hold/Decline + optional note); the tool never decides (UI-SPEC
// D.7 §7). zod at the boundary; audited automatically (the change history lives in
// audit_logs). A Result only exists for a SUBMITTED + computed assessment, so a
// decision before compute resolves to 404 → surfaced as "compute the result first".
export const POST = withRateLimit(
  withManagerAuth(async (request: NextRequest, { params, session }) => {
    const orgId = session.user.orgId;
    if (!orgId) return err("No organization context", 400);
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const parsed = decisionInputSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "), 422);
    }

    const outcome = await recordDecision(orgId, id, session.user.id, parsed.data);
    if (outcome.kind === "not-found") {
      return err("No computed result to decide on — compute the result first", 409);
    }
    return ok(outcome.result);
  }),
  { id: "result-decision", limit: 30, windowMs: 60_000 }
);
