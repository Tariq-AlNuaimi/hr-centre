import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { approvalView } from "@/lib/hiring/requisition-views";
import { loadRequisition } from "@/lib/hiring/requisitions";
import { hiringRoute } from "@/lib/hiring/route";

/** The step-2 approval screen: routed chain, this round's signatures, budget check, SoD. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id);
      if (!l) return notFound("Requisition");
      return ok(await approvalView(actor, l));
    }),
  ),
  { id: "hiring-requisition-read", limit: 240, windowMs: 60_000 },
);
