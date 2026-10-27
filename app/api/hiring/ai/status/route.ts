import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden, ok } from "@/lib/api-response";
import { holdsAnywhere } from "@/lib/hiring/access";
import { aiConfigured, getAiLimits } from "@/lib/hiring/ai/config";
import { hiringRoute } from "@/lib/hiring/route";

/** Whether AI buttons should be live: configured and not switched off. No config detail leaves. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { actor }) => {
      if (!holdsAnywhere(actor, "hiring.view")) return forbidden();
      const [configured, limits] = await Promise.all([aiConfigured(), getAiLimits()]);
      return ok({ configured, switchedOff: limits.killSwitch });
    }),
  ),
  { id: "hiring-ai-read", limit: 240, windowMs: 60_000 },
);
