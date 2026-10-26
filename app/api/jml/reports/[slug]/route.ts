import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { runReport } from "@/lib/jml/reports/registry";
import { jml, query, requireAnywhere } from "@/lib/jml/route";
import { reportFilterSchema } from "@/lib/validations/jml/report";

/** One report (jml.viewReports; rows inside the actor's report scope). */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      requireAnywhere(actor, "jml.viewReports");
      return ok(await runReport(actor, params.slug!, query(req, reportFilterSchema)));
    }),
  ),
  { id: "jml-reports-read", limit: 30, windowMs: 60_000 },
);
