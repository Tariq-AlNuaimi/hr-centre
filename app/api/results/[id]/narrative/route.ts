import { NextRequest } from "next/server";
import { withManagerAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { generateNarrative } from "@/lib/services/result";

// POST /api/results/[id]/narrative — id = RESULT id. AI Role 2 (ARCHITECTURE §4):
// generate/regenerate the numbers-bound narrative and cache it on the Result.
// withManagerAuth + orgId; rate limited OUTSIDE (an external LLM call). When the
// LLM is unconfigured this is a calm 503 — the numbers still render without it.
export const POST = withRateLimit(
  withManagerAuth(async (_request: NextRequest, { params, session }) => {
    const orgId = session.user.orgId;
    if (!orgId) return err("No organization context", 400);
    const { id } = await params;

    const outcome = await generateNarrative(orgId, id);
    switch (outcome.kind) {
      case "ok":
        return ok({ narrative: outcome.narrative });
      case "not-found":
        return err("Result not found", 404);
      case "llm-not-configured":
        return err("AI narrative is not configured on this deployment", 503);
      case "llm-failed":
        // Log the raw detail server-side only — it can carry the internal LLM
        // endpoint / transport error; staff get a generic message.
        console.error(`[results.narrative] LLM failed for result ${id}: ${outcome.detail}`);
        return err("Could not generate the narrative", 502);
    }
  }),
  { id: "result-narrative", limit: 10, windowMs: 60_000 }
);
