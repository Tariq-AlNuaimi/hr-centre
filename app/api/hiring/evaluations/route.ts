import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { createEvaluation, listEvaluations } from "@/lib/hiring/evaluations";
import { hiringRoute, parseBody, parseQuery } from "@/lib/hiring/route";
import {
  createEvaluationSchema,
  evaluationListQuerySchema,
} from "@/lib/validations/hiring/interview";

/** Scorecards across HR's requisitions, and recording one on a panelist's behalf. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const q = parseQuery(req, evaluationListQuerySchema);
      if ("response" in q) return q.response;
      return ok(await listEvaluations(actor, q.data));
    }),
  ),
  { id: "hiring-interview-read", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const body = await parseBody(req, createEvaluationSchema);
      if ("response" in body) return body.response;
      return created(await createEvaluation(actor, body.data));
    }),
  ),
  { id: "hiring-interviews-write", limit: 60, windowMs: 60_000 },
);
