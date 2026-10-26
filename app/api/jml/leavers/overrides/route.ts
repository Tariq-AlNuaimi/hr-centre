import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { overridesForMonth } from "@/lib/jml/leave/gates";
import { jml, query, requireAnywhere } from "@/lib/jml/route";
import { overridesQuerySchema } from "@/lib/validations/jml/leave";

/** The monthly gate-override report (AC-12.3). */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireAnywhere(actor, "jml.viewReports");
      return ok(await overridesForMonth(actor, query(req, overridesQuerySchema).month));
    }),
  ),
  { id: "jml-leavers-read", limit: 120, windowMs: 60_000 },
);
