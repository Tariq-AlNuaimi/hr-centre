import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { setStallCause } from "@/lib/hiring/candidate-stage";
import { loadCandidate } from "@/lib/hiring/candidates";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { stallCauseSchema } from "@/lib/validations/hiring/candidate";

/** Why a candidate is stuck at their current stage (cleared by any stage move). */
export const PATCH = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadCandidate(actor, id, "hiring.manage");
      if (!l) return notFound("Candidate");
      const body = await parseBody(req, stallCauseSchema);
      if ("response" in body) return body.response;
      await setStallCause(actor, l, body.data);
      return ok({ id });
    }),
  ),
  { id: "hiring-candidates-write", limit: 60, windowMs: 60_000 },
);
