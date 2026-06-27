import { NextRequest } from "next/server";
import { withManagerAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { computeResult } from "@/lib/services/result";

// POST /api/results/[id]/compute  — id = ASSESSMENT id (Phase-6 blueprint).
// Lazy compute-on-view + persist; `?recompute=1` forces a recompute (preserving the
// decision + narrative). withManagerAuth (any staff role) + orgId scoping; rate
// limited OUTSIDE the auth wrapper (a write that calls an external scorer). Honest,
// typed states map to specific codes — never a 500 or a green response over a
// scoring outage (UI-SPEC D.7 states).
export const POST = withRateLimit(
  withManagerAuth(async (request: NextRequest, { params, session }) => {
    const orgId = session.user.orgId;
    if (!orgId) return err("No organization context", 400);
    const { id } = await params;

    const force = request.nextUrl.searchParams.get("recompute") === "1";
    const outcome = await computeResult(orgId, id, { force });

    switch (outcome.kind) {
      case "ok":
        return ok(outcome.result);
      case "not-found":
        return err("Assessment not found", 404);
      case "not-submitted":
        return err("This assessment has not been completed yet", 409);
      case "incomplete":
        return err(
          `This assessment has ${outcome.have} of ${outcome.need} responses and can't be scored`,
          409
        );
      case "no-active-profile":
        return err("The role profile for this assessment is unavailable", 409);
      case "scoring-not-configured":
        // 503: a healthy "feature not wired" state, surfaced calmly by the UI.
        return err("Scoring is not configured on this deployment", 503);
      case "scoring-unreachable":
        // Log the raw detail server-side only — it can carry the internal scorer URL
        // / transport error; staff get a generic message (no internal-infra leak).
        console.error(`[results.compute] scoring unreachable for assessment ${id}: ${outcome.detail}`);
        return err("Could not reach the scoring service", 502);
    }
  }),
  { id: "result-compute", limit: 20, windowMs: 60_000 }
);
