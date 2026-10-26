import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { can } from "@/lib/hiring/access";
import { carriedFocus, listInterviews } from "@/lib/hiring/interview-views";
import { loadRoundPlan, replaceRoundPlan } from "@/lib/hiring/interviews";
import { loadRequisition } from "@/lib/hiring/requisitions";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { roundPlanSchema } from "@/lib/validations/hiring/interview";

/**
 * One requisition's interview schedule: the round plan (brief), the booked
 * interviews (panel-only readers: theirs) and the assessment focus carried
 * into round 1. PUT replaces the round plan.
 */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id);
      if (!l) return notFound("Requisition");
      const manage = can(actor, "hiring.manage", l.subject);
      const [plan, rows, carried] = await Promise.all([
        loadRoundPlan(id),
        listInterviews(actor, {
          page: 1,
          pageSize: 100,
          requisitionId: id,
          sort: "scheduledDate",
          order: "asc",
        }),
        manage ? carriedFocus(id) : Promise.resolve([]),
      ]);
      return ok({
        requisition: { id, title: l.req.title },
        plan,
        rows: rows.data,
        total: rows.total,
        carried,
        can: { manage },
      });
    }),
  ),
  { id: "hiring-interview-read", limit: 240, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id, "hiring.manage");
      if (!l) return notFound("Requisition");
      const body = await parseBody(req, roundPlanSchema);
      if ("response" in body) return body.response;
      await replaceRoundPlan(id, body.data.rounds);
      return ok({ rounds: await loadRoundPlan(id) });
    }),
  ),
  { id: "hiring-interviews-write", limit: 60, windowMs: 60_000 },
);
