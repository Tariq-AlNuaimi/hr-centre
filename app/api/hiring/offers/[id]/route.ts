import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { deleteOffer, updateOffer } from "@/lib/hiring/offer-write";
import { loadOffer, offerDetail } from "@/lib/hiring/offers";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { updateOfferSchema } from "@/lib/validations/hiring/offer";

/** One offer: read (HR or an approver on it), edit / move status (HR), delete (HR, not once live). */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadOffer(actor, id);
      if (!l) return notFound("Offer");
      return ok(offerDetail(l));
    }),
  ),
  { id: "hiring-offer-read", limit: 240, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadOffer(actor, id, "manage");
      if (!l) return notFound("Offer");
      const body = await parseBody(req, updateOfferSchema);
      if ("response" in body) return body.response;
      return ok(await updateOffer(actor, l, body.data));
    }),
  ),
  { id: "hiring-offer-write", limit: 60, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadOffer(actor, id, "manage");
      if (!l) return notFound("Offer");
      await deleteOffer(actor, l);
      return ok({ id, deleted: true });
    }),
  ),
  { id: "hiring-offer-write", limit: 60, windowMs: 60_000 },
);
