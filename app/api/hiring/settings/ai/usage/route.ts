import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden, ok } from "@/lib/api-response";
import { isHiringAdmin } from "@/lib/hiring/access";
import { aiUsage } from "@/lib/hiring/ai/admin";
import { hiringRoute } from "@/lib/hiring/route";

/** Today's AI usage against the caps, and the last 14 days by feature (hiring admin). */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { actor }) => {
      if (!isHiringAdmin(actor)) return forbidden();
      return ok(await aiUsage());
    }),
  ),
  { id: "hiring-settings-read", limit: 120, windowMs: 60_000 },
);
