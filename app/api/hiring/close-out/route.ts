import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { listCloseOut, markNoticesSent } from "@/lib/hiring/close-out";
import { hiringRoute, parseBody, parseQuery } from "@/lib/hiring/route";
import { closeOutMarkSchema, closeOutQuerySchema } from "@/lib/validations/hiring/offer";

/** Step 13: rejected candidates and their notice (sent / held / ready); mark notices sent by hand. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const q = parseQuery(req, closeOutQuerySchema);
      if ("response" in q) return q.response;
      return ok(await listCloseOut(actor, q.data));
    }),
  ),
  { id: "hiring-candidate-read", limit: 60, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const body = await parseBody(req, closeOutMarkSchema);
      if ("response" in body) return body.response;
      return ok(await markNoticesSent(actor, body.data.candidateIds));
    }),
  ),
  { id: "hiring-candidate-write", limit: 20, windowMs: 60_000 },
);
