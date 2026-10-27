import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { listVersions, reviseOffer } from "@/lib/hiring/offer-versions";
import { loadOffer } from "@/lib/hiring/offers";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { reviseOfferSchema } from "@/lib/validations/hiring/offer";

/** The sent versions (terms for comp readers only), and sending a revised offer. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadOffer(actor, id);
      if (!l) return notFound("Offer");
      return ok({ versions: await listVersions(l) });
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
      const body = await parseBody(req, reviseOfferSchema);
      if ("response" in body) return body.response;
      return ok(await reviseOffer(actor, l, body.data));
    }),
  ),
  { id: "hiring-offer-write", limit: 60, windowMs: 60_000 },
);
