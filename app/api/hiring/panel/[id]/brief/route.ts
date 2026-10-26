import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { brief, loadMyInterview } from "@/lib/hiring/panel";
import { hiringRoute } from "@/lib/hiring/route";

/** The panelist's brief — facts only (D7: no nationality, contact or raw profile). */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      return ok(await brief(actor, await loadMyInterview(actor, id)));
    }),
  ),
  { id: "hiring-panel-read", limit: 240, windowMs: 60_000 },
);
