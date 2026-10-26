import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { myPanels } from "@/lib/hiring/panel";
import { hiringRoute } from "@/lib/hiring/route";

/** The interviews I sit on: awaiting my scorecard, and submitted. */
export const GET = withRateLimit(
  withAuth(hiringRoute(async (_req, { actor }) => ok(await myPanels(actor)))),
  { id: "hiring-panel-read", limit: 240, windowMs: 60_000 },
);
