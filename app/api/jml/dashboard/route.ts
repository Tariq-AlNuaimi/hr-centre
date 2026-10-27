import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { jmlDashboard } from "@/lib/jml/dashboard";
import { jml, query, requireAnywhere } from "@/lib/jml/route";
import { dashboardQuerySchema } from "@/lib/validations/jml/case";

/** The JML dashboard (Offboarding Module 11 + Onboarding's), scoped; mine by default for case owners. */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireAnywhere(actor, "jml.view");
      return ok(await jmlDashboard(actor, query(req, dashboardQuerySchema).scope));
    }),
  ),
  { id: "jml-dashboard", limit: 60, windowMs: 60_000 },
);
