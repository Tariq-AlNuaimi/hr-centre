import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { compare, loadMyInterview } from "@/lib/hiring/panel";
import { hiringRoute } from "@/lib/hiring/route";

/** After my own scorecard: the panel's submitted scorecards and the AI transcript analysis (D14). */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      return ok(await compare(actor, await loadMyInterview(actor, id)));
    }),
  ),
  { id: "hiring-panel-read", limit: 240, windowMs: 60_000 },
);
