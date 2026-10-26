import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { packageAction, packageView } from "@/lib/hiring/candidate-files";
import { loadCandidate } from "@/lib/hiring/candidates";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { packageActionSchema } from "@/lib/validations/hiring/candidate";

/** Package confirmation (step 9): the evidence trail, and request / decline / confirm / reopen. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadCandidate(actor, id, "hiring.manage");
      if (!l) return notFound("Candidate");
      return ok(await packageView(actor, l));
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
      const body = await parseBody(req, packageActionSchema);
      if ("response" in body) return body.response;
      await packageAction(actor, l, body.data);
      return ok({ id, action: body.data.action });
    }),
  ),
  { id: "hiring-candidates-write", limit: 60, windowMs: 60_000 },
);
