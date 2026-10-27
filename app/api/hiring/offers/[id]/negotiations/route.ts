import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, notFound, ok } from "@/lib/api-response";
import { addNote, thread } from "@/lib/hiring/negotiations";
import { loadOffer } from "@/lib/hiring/offers";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { negotiationNoteSchema } from "@/lib/validations/hiring/offer";

/** The negotiation thread (with the candidate's pre-offer notes). Pay talk: comp readers only. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadOffer(actor, id);
      if (!l) return notFound("Offer");
      return ok(await thread(l.offer.candidateId, l.offer.id, l.comp));
    }),
  ),
  { id: "hiring-offer-read", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadOffer(actor, id, "manage");
      if (!l) return notFound("Offer");
      const body = await parseBody(req, negotiationNoteSchema);
      if ("response" in body) return body.response;
      return created(
        await addNote(
          actor,
          { candidateId: l.offer.candidateId, offerId: l.offer.id },
          l.comp,
          body.data,
        ),
      );
    }),
  ),
  { id: "hiring-offer-write", limit: 60, windowMs: 60_000 },
);
