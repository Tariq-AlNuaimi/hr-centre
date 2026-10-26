import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, notFound } from "@/lib/api-response";
import { addNeed, loadRound } from "@/lib/hiring/planning";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { createNeedSchema } from "@/lib/validations/hiring/planning";

/** Canvass a department in this cycle (≤100 per cycle, once each). */
export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const round = await loadRound(actor, id, "hiring.manage");
      if (!round) return notFound("Planning cycle");
      const body = await parseBody(req, createNeedSchema);
      if ("response" in body) return body.response;
      return created(await addNeed(round, body.data));
    }),
  ),
  { id: "hiring-planning-write", limit: 60, windowMs: 60_000 },
);
