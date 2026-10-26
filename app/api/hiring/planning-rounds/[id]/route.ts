import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { loadRound, roundView, updateRound } from "@/lib/hiring/planning";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { updatePlanningRoundSchema } from "@/lib/validations/hiring/planning";

export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const view = await roundView(actor, id);
      return view ? ok(view) : notFound("Planning cycle");
    }),
  ),
  { id: "hiring-planning-read", limit: 240, windowMs: 60_000 },
);

export const PATCH = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const round = await loadRound(actor, id, "hiring.manage");
      if (!round) return notFound("Planning cycle");
      const body = await parseBody(req, updatePlanningRoundSchema);
      if ("response" in body) return body.response;
      return ok(await updateRound(id, round, body.data));
    }),
  ),
  { id: "hiring-planning-write", limit: 60, windowMs: 60_000 },
);
