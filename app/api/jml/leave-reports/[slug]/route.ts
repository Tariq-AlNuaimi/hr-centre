import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { runLeaveReport } from "@/lib/jml/reports/leave/registry";
import { jml, query, requireAnywhere } from "@/lib/jml/route";
import { leaveReportFilterSchema } from "@/lib/validations/jml/report";

/** One of R1–R8, scoped to what the reader may report on, small cells suppressed. */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      requireAnywhere(actor, "jml.viewReports");
      return ok(await runLeaveReport(actor, params.slug!, query(req, leaveReportFilterSchema)));
    }),
  ),
  { id: "jml-reports-read", limit: 60, windowMs: 60_000 },
);
