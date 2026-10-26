import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { loadMyInterview, myScorecard, saveScorecard } from "@/lib/hiring/panel";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { panelScoreSchema } from "@/lib/validations/hiring/interview";

/** My scorecard on this interview: read the draft, save it, or submit it (once). */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      await loadMyInterview(actor, id);
      return ok(await myScorecard(actor, id));
    }),
  ),
  { id: "hiring-panel-read", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadMyInterview(actor, id);
      const body = await parseBody(req, panelScoreSchema);
      if ("response" in body) return body.response;
      return ok(await saveScorecard(actor, l, body.data));
    }),
  ),
  { id: "hiring-panel-write", limit: 120, windowMs: 60_000 },
);
