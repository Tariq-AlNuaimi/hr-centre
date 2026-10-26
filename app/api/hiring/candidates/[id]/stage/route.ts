import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { moveStage } from "@/lib/hiring/candidate-stage";
import { loadCandidate } from "@/lib/hiring/candidates";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { stageMoveSchema } from "@/lib/validations/hiring/candidate";

/**
 * Move a candidate. A skipped mandatory step answers 422 with a code the UI
 * branches on: GATE_FORBIDDEN (not an HR Manager), GATE_CONFIRM_REQUIRED,
 * GATE_REASON_REQUIRED.
 */
export const PATCH = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadCandidate(actor, id, "hiring.manage");
      if (!l) return notFound("Candidate");
      const body = await parseBody(req, stageMoveSchema);
      if ("response" in body) return body.response;
      await moveStage(actor, l, body.data);
      return ok({ id, stage: body.data.stage });
    }),
  ),
  { id: "hiring-candidates-write", limit: 60, windowMs: 60_000 },
);
