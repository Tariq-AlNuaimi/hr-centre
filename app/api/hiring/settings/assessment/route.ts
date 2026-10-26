import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden, ok } from "@/lib/api-response";
import { holdsAnywhere } from "@/lib/hiring/access";
import { policyView, savePolicy } from "@/lib/hiring/assessments";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { assessmentPolicySchema } from "@/lib/validations/hiring/candidate";

/** The org-wide assessment policy. Changing it needs an org-wide HR Manager or admin. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { actor }) => {
      if (!holdsAnywhere(actor, "hiring.manage")) return forbidden();
      return ok(await policyView(actor));
    }),
  ),
  { id: "hiring-settings-read", limit: 120, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const body = await parseBody(req, assessmentPolicySchema);
      if ("response" in body) return body.response;
      await savePolicy(actor, body.data);
      return ok(body.data);
    }),
  ),
  { id: "hiring-settings-write", limit: 30, windowMs: 60_000 },
);
