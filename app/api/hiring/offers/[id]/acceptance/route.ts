import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { recordAcceptance } from "@/lib/hiring/offer-acceptance";
import { loadOffer } from "@/lib/hiring/offers";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { acceptanceSchema } from "@/lib/validations/hiring/offer";

/** Record the candidate's acceptance (joining date = offered start date; D4 side effects). */
export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadOffer(actor, id, "manage");
      if (!l) return notFound("Offer");
      const body = await parseBody(req, acceptanceSchema);
      if ("response" in body) return body.response;
      return ok(await recordAcceptance(actor, l, body.data));
    }),
  ),
  { id: "hiring-offer-write", limit: 60, windowMs: 60_000 },
);
