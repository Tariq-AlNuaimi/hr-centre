import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden, ok } from "@/lib/api-response";
import { holdsAnywhere, isHiringAdmin } from "@/lib/hiring/access";
import { DEFAULT_OFFER_TEMPLATE, MERGE_FIELDS, templateBody } from "@/lib/hiring/offer-letter";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { writeSetting } from "@/lib/hiring/settings";
import { offerLetterTemplateSchema } from "@/lib/validations/hiring/offer";

/** The offer-letter opening paragraph (`offerLetter.template`). Read: HR; change: hiring admin. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { actor }) => {
      if (!holdsAnywhere(actor, "hiring.manage")) return forbidden();
      const body = await templateBody();
      return ok({
        body,
        isDefault: body === DEFAULT_OFFER_TEMPLATE,
        defaultBody: DEFAULT_OFFER_TEMPLATE,
        mergeFields: MERGE_FIELDS,
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
      const body = await parseBody(req, offerLetterTemplateSchema);
      if ("response" in body) return body.response;
      await writeSetting("offerLetter.template", body.data);
      return ok(body.data);
    }),
  ),
  { id: "hiring-settings-write", limit: 30, windowMs: 60_000 },
);
