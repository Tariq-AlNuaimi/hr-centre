import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { loadEvaluation, updateEvaluation } from "@/lib/hiring/evaluations";
import { resolveBriefForRound } from "@/lib/hiring/interview-rules";
import { loadRoundPlan } from "@/lib/hiring/interviews";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { prisma } from "@/lib/prisma";
import { updateEvaluationSchema } from "@/lib/validations/hiring/interview";

/** One scorecard, for HR on the requisition. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const e = await loadEvaluation(actor, id);
      if (!e) return notFound("Scorecard");
      // The round's own competencies, as the panelist's brief showed them.
      const brief = resolveBriefForRound(
        await loadRoundPlan(e.card.interview.requisition.id),
        e.card.interview.round,
      );
      const competencies = brief.competencies.length
        ? brief.competencies
        : e.card.interview.requisition.competencies;
      return ok({ ...e.card, panelist: e.panelist, competencies });
    }),
  ),
  { id: "hiring-interview-read", limit: 240, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const e = await loadEvaluation(actor, id);
      if (!e) return notFound("Scorecard");
      const body = await parseBody(req, updateEvaluationSchema);
      if ("response" in body) return body.response;
      await updateEvaluation(e.card, body.data);
      return ok({ id });
    }),
  ),
  { id: "hiring-interviews-write", limit: 60, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const e = await loadEvaluation(actor, id);
      if (!e) return notFound("Scorecard");
      await prisma.hiringScorecard.delete({ where: { id } });
      return ok({ id, deleted: true });
    }),
  ),
  { id: "hiring-interviews-write", limit: 60, windowMs: 60_000 },
);
