import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { createOffer } from "@/lib/hiring/offer-write";
import { listOffers } from "@/lib/hiring/offers";
import { hiringRoute, parseBody, parseQuery } from "@/lib/hiring/route";
import { createOfferSchema, offerListQuerySchema } from "@/lib/validations/hiring/offer";

/** Offers in the actor's scope (pay for comp readers only), and drafting a new one. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const q = parseQuery(req, offerListQuerySchema);
      if ("response" in q) return q.response;
      return ok(await listOffers(actor, q.data));
    }),
  ),
  { id: "hiring-offer-read", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const body = await parseBody(req, createOfferSchema);
      if ("response" in body) return body.response;
      return created(await createOffer(actor, body.data));
    }),
  ),
  { id: "hiring-offer-write", limit: 60, windowMs: 60_000 },
);
