import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { auditTrail, statusHistory } from "@/lib/hiring/requisition-views";
import { bandFor, loadRequisition } from "@/lib/hiring/requisitions";
import { hiringRoute } from "@/lib/hiring/route";

/** Status timeline + audit trail (band values withheld from non-pay readers). */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id);
      if (!l) return notFound("Requisition");
      const [status, audit] = await Promise.all([
        statusHistory(id),
        auditTrail(id, !bandFor(actor, l).bandHidden),
      ]);
      return ok({ status, audit });
    }),
  ),
  { id: "hiring-requisition-read", limit: 240, windowMs: 60_000 },
);
