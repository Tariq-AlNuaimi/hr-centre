import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import {
  clearPreferred,
  loadComparison,
  rejectFinalist,
  selectPreferred,
} from "@/lib/hiring/comparison";
import { loadRequisition } from "@/lib/hiring/requisitions";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { comparisonActionSchema } from "@/lib/validations/hiring/interview";

/** The evaluation comparison (step 8) and the decision: select / clear the preferred candidate, reject a finalist. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id, "hiring.manage");
      if (!l) return notFound("Requisition");
      return ok(await loadComparison(l));
    }),
  ),
  { id: "hiring-interview-read", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id, "hiring.manage");
      if (!l) return notFound("Requisition");
      const body = await parseBody(req, comparisonActionSchema);
      if ("response" in body) return body.response;
      const b = body.data;
      if (b.action === "select-preferred")
        return ok(await selectPreferred(actor, l, b.candidateId, b.note));
      if (b.action === "reject-finalist")
        return ok(await rejectFinalist(actor, l, b.candidateId, b.reason));
      return ok(await clearPreferred(l, b.candidateId));
    }),
  ),
  { id: "hiring-interviews-write", limit: 60, windowMs: 60_000 },
);
