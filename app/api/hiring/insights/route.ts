import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden, ok } from "@/lib/api-response";
import { insightsView } from "@/lib/hiring/analytics";
import { hiringRoute } from "@/lib/hiring/route";

/** Hiring insights over the records the reader may see (D12). Aggregates only. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { actor }) => {
      const view = await insightsView(actor);
      return view ? ok(view) : forbidden();
    }),
  ),
  { id: "hiring-insights", limit: 60, windowMs: 60_000 },
);
