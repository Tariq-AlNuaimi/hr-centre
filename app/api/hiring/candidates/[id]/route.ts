import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { candidateDetail } from "@/lib/hiring/candidate-views";
import { deleteCandidate, updateCandidate } from "@/lib/hiring/candidate-write";
import { loadCandidate } from "@/lib/hiring/candidates";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { updateCandidateSchema } from "@/lib/validations/hiring/candidate";

/** One candidate, projected by right. Out of scope (or not on your panel) = 404. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadCandidate(actor, id);
      if (!l) return notFound("Candidate");
      return ok(await candidateDetail(actor, l));
    }),
  ),
  { id: "hiring-candidate-read", limit: 240, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadCandidate(actor, id, "hiring.manage");
      if (!l) return notFound("Candidate");
      const body = await parseBody(req, updateCandidateSchema);
      if ("response" in body) return body.response;
      await updateCandidate(actor, l, body.data);
      return ok({ id });
    }),
  ),
  { id: "hiring-candidates-write", limit: 60, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadCandidate(actor, id, "hiring.manage");
      if (!l) return notFound("Candidate");
      await deleteCandidate(actor, l.cand);
      return ok({ id, deleted: true });
    }),
  ),
  { id: "hiring-candidates-write", limit: 60, windowMs: 60_000 },
);
