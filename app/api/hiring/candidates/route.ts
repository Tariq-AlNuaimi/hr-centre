import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { createCandidate } from "@/lib/hiring/candidate-write";
import { listCandidates } from "@/lib/hiring/candidates";
import { hiringRoute, parseBody, parseQuery } from "@/lib/hiring/route";
import {
  candidateListQuerySchema,
  createCandidateSchema,
} from "@/lib/validations/hiring/candidate";

/** Candidates in the actor's scope (paged ≤100), and adding one by hand. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const q = parseQuery(req, candidateListQuerySchema);
      if ("response" in q) return q.response;
      return ok(await listCandidates(actor, q.data));
    }),
  ),
  { id: "hiring-candidate-read", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const body = await parseBody(req, createCandidateSchema);
      if ("response" in body) return body.response;
      return created(await createCandidate(actor, body.data));
    }),
  ),
  { id: "hiring-candidates-write", limit: 60, windowMs: 60_000 },
);
