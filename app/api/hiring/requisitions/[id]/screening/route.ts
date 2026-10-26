import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { loadRequisition } from "@/lib/hiring/requisitions";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { screeningAction, screeningView } from "@/lib/hiring/screening";
import { screeningActionSchema } from "@/lib/validations/hiring/candidate";

/** CV screening for one requisition: the ranked queue, and shortlist / reject a selection. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id, "hiring.manage");
      if (!l) return notFound("Requisition");
      return ok(await screeningView(actor, l));
    }),
  ),
  { id: "hiring-candidate-read", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id, "hiring.manage");
      if (!l) return notFound("Requisition");
      const body = await parseBody(req, screeningActionSchema);
      if ("response" in body) return body.response;
      return ok(await screeningAction(actor, l, body.data));
    }),
  ),
  { id: "hiring-bulk", limit: 10, windowMs: 60_000 },
);
