import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { loadMyInterview, reviseScorecard } from "@/lib/hiring/panel";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { panelReviseSchema } from "@/lib/validations/hiring/interview";

/** Change a submitted scorecard after the reveal — the reason goes on the audit trail. */
export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadMyInterview(actor, id);
      const body = await parseBody(req, panelReviseSchema);
      if ("response" in body) return body.response;
      return ok(await reviseScorecard(actor, l, body.data));
    }),
  ),
  { id: "hiring-panel-write", limit: 120, windowMs: 60_000 },
);
