import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, notFound, ok } from "@/lib/api-response";
import { loadCandidate, seesCandidateComp } from "@/lib/hiring/candidates";
import { addNote, thread } from "@/lib/hiring/negotiations";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { negotiationNoteSchema } from "@/lib/validations/hiring/offer";

/** Pre-offer alignment notes on a candidate (before an offer exists). Comp readers only. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadCandidate(actor, id, "hiring.manage");
      if (!l) return notFound("Candidate");
      return ok(await thread(l.cand.id, null, seesCandidateComp(actor, l)));
    }),
  ),
  { id: "hiring-candidate-read", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadCandidate(actor, id, "hiring.manage");
      if (!l) return notFound("Candidate");
      const body = await parseBody(req, negotiationNoteSchema);
      if ("response" in body) return body.response;
      return created(
        await addNote(
          actor,
          { candidateId: l.cand.id, offerId: null },
          seesCandidateComp(actor, l),
          body.data,
        ),
      );
    }),
  ),
  { id: "hiring-candidate-write", limit: 60, windowMs: 60_000 },
);
