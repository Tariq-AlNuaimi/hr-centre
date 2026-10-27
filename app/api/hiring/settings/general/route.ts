import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden, ok } from "@/lib/api-response";
import { holdsAnywhere, isHiringAdmin } from "@/lib/hiring/access";
import { generalSettings, saveGeneral } from "@/lib/hiring/ai/admin";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { generalSettingsSchema } from "@/lib/validations/hiring/ai";

/** Fit weights, panel AI mode, offer chains + COO threshold, budget envelopes. Read: HR; change: hiring admin. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { actor }) => {
      if (!holdsAnywhere(actor, "hiring.manage")) return forbidden();
      return ok({ ...(await generalSettings()), canEdit: isHiringAdmin(actor) });
    }),
  ),
  { id: "hiring-settings-read", limit: 120, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      if (!isHiringAdmin(actor)) return forbidden();
      const body = await parseBody(req, generalSettingsSchema);
      if ("response" in body) return body.response;
      await saveGeneral(body.data);
      return ok({ ...(await generalSettings()), canEdit: true });
    }),
  ),
  { id: "hiring-settings-write", limit: 30, windowMs: 60_000 },
);
