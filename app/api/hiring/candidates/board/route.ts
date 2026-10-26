import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { boardCards } from "@/lib/hiring/candidate-views";
import { loadRequisition } from "@/lib/hiring/requisitions";
import { hiringRoute, parseQuery } from "@/lib/hiring/route";
import { boardQuerySchema } from "@/lib/validations/hiring/candidate";

/** The pipeline board: active candidates (≤1,000, `truncated` says when more exist). */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const q = parseQuery(req, boardQuerySchema);
      if ("response" in q) return q.response;
      if (q.data.requisitionId) {
        const l = await loadRequisition(actor, q.data.requisitionId, "hiring.manage");
        if (!l) return notFound("Requisition");
      }
      return ok(await boardCards(actor, q.data.requisitionId));
    }),
  ),
  { id: "hiring-candidate-read", limit: 240, windowMs: 60_000 },
);
