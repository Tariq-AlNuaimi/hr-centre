import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden, ok } from "@/lib/api-response";
import { isHiringAdmin } from "@/lib/hiring/access";
import { saveAiLimits } from "@/lib/hiring/ai/admin";
import { getAiLimits } from "@/lib/hiring/ai/config";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { aiLimitsSchema } from "@/lib/validations/hiring/ai";

/** Kill-switch, daily caps, timeout and prices (hiring admin). */
export const PUT = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      if (!isHiringAdmin(actor)) return forbidden();
      const body = await parseBody(req, aiLimitsSchema);
      if ("response" in body) return body.response;
      await saveAiLimits(body.data);
      return ok(await getAiLimits());
    }),
  ),
  { id: "hiring-settings-write", limit: 30, windowMs: 60_000 },
);
