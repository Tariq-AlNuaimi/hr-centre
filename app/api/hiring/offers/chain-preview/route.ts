import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { previewChain } from "@/lib/hiring/offer-approvals";
import { hiringRoute, parseQuery } from "@/lib/hiring/route";
import { chainPreviewQuerySchema } from "@/lib/validations/hiring/offer";

/** The approval chain an offer for this candidate at this TOTAL monthly pay would route to. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const q = parseQuery(req, chainPreviewQuerySchema);
      if ("response" in q) return q.response;
      const preview = await previewChain(actor, q.data.candidateId, q.data.total ?? null);
      if (!preview) return notFound("Candidate");
      return ok(preview);
    }),
  ),
  { id: "hiring-offer-read", limit: 240, windowMs: 60_000 },
);
