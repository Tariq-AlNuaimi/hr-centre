import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden, ok } from "@/lib/api-response";
import { holdsAnywhere, isHiringAdmin } from "@/lib/hiring/access";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { asNumber, readSetting, writeSetting } from "@/lib/hiring/settings";
import { careersSettingsSchema } from "@/lib/validations/hiring/public";

/** The careers page's per-role daily application cap (0 = no cap). Read: HR; change: hiring admin. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { actor }) => {
      if (!holdsAnywhere(actor, "hiring.manage")) return forbidden();
      return ok({
        dailyCapPerRequisition: asNumber(await readSetting("careers.dailyCapPerPosition"), 0),
        canEdit: isHiringAdmin(actor),
      });
    }),
  ),
  { id: "hiring-settings-read", limit: 120, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      if (!isHiringAdmin(actor)) return forbidden();
      const body = await parseBody(req, careersSettingsSchema);
      if ("response" in body) return body.response;
      await writeSetting("careers.dailyCapPerPosition", body.data.dailyCapPerRequisition);
      return ok(body.data);
    }),
  ),
  { id: "hiring-settings-write", limit: 30, windowMs: 60_000 },
);
