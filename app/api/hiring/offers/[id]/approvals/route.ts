import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { approvalView, decideOffer } from "@/lib/hiring/offer-approvals";
import { loadOffer } from "@/lib/hiring/offers";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { offerDecisionSchema } from "@/lib/validations/hiring/offer";

/** The offer's approval chain, and deciding its next step (SoD, recusal, D17). */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadOffer(actor, id);
      if (!l) return notFound("Offer");
      return ok(await approvalView(actor, l));
    }),
  ),
  { id: "hiring-offer-read", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadOffer(actor, id);
      if (!l) return notFound("Offer");
      const body = await parseBody(req, offerDecisionSchema);
      if ("response" in body) return body.response;
      return ok(await decideOffer(actor, l, body.data));
    }),
  ),
  { id: "hiring-offer-write", limit: 60, windowMs: 60_000 },
);
