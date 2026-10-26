import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import {
  advance,
  invite,
  listAssessments,
  policyView,
  recordResult,
  remind,
} from "@/lib/hiring/assessments";
import { loadRequisition } from "@/lib/hiring/requisitions";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { assessmentActionSchema } from "@/lib/validations/hiring/candidate";

/** The aptitude-assessment queue of one requisition (shortlisted + at assessment). */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id, "hiring.manage");
      if (!l) return notFound("Requisition");
      const [policy, rows] = await Promise.all([policyView(actor), listAssessments(id)]);
      return ok({ requisition: { id, title: l.req.title }, policy, rows });
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
      const body = await parseBody(req, assessmentActionSchema);
      if ("response" in body) return body.response;
      const b = body.data;
      if (b.action === "invite") {
        return ok(await invite(actor, id, b.candidateIds, b.dueAt ? new Date(b.dueAt) : null));
      }
      if (b.action === "remind") return ok(await remind(id, b.candidateIds));
      if (b.action === "advance") return ok(await advance(actor, id, b.candidateIds));
      await recordResult(id, b);
      return ok({ recorded: b.candidateId });
    }),
  ),
  { id: "hiring-candidates-write", limit: 60, windowMs: 60_000 },
);
