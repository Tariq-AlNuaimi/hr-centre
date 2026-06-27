import { NextRequest } from "next/server";
import { withManagerAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { outcomeInputSchema } from "@/lib/validations/calibration";
import { recordOutcome } from "@/lib/services/calibration";

// POST /api/calibration/outcomes — record/correct a candidate's post-hire outcome
// (ARCHITECTURE §7, UI-SPEC D.9). withManagerAuth (the manager who advanced the hire
// records what happened); orgId-scoped; zod at the boundary; audited automatically;
// rate limited OUTSIDE the auth wrapper. Typed domain states map to calm codes —
// never a 500 or a green response over an invalid entry.
export const POST = withRateLimit(
  withManagerAuth(async (request: NextRequest, { session }) => {
    const orgId = session.user.orgId;
    if (!orgId) return err("No organization context", 400);

    const body = await request.json().catch(() => null);
    const parsed = outcomeInputSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "), 422);
    }

    const outcome = await recordOutcome(orgId, session.user.id, parsed.data);
    switch (outcome.kind) {
      case "ok":
        return ok(outcome.outcome);
      case "not-found":
        return err("Result not found", 404);
      case "invalid":
        return err(outcome.message, 422);
      case "conflict":
        return err(outcome.message, 409);
    }
  }),
  { id: "calibration-outcome", limit: 30, windowMs: 60_000 }
);
