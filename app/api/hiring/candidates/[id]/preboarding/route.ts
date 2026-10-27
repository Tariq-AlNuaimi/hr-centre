import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { loadCandidate } from "@/lib/hiring/candidates";
import { preboardingView, recordHandover, retryHandoff } from "@/lib/hiring/preboarding";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { preboardingActionSchema } from "@/lib/validations/hiring/candidate";

/** Step 14: the pre-boarding view; record the handover or retry the JML hand-off. HR in scope. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadCandidate(actor, id, "hiring.manage");
      if (!l) return notFound("Candidate");
      return ok(await preboardingView(actor, l));
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
      const body = await parseBody(req, preboardingActionSchema);
      if ("response" in body) return body.response;
      if (body.data.action === "handoff") return ok(await retryHandoff(actor, l));
      return ok(await recordHandover(actor, l, body.data));
    }),
  ),
  { id: "hiring-candidates-write", limit: 30, windowMs: 60_000 },
);
