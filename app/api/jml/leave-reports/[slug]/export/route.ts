import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { NextResponse } from "next/server";
import { xlsxDownloadHeaders } from "@/lib/pms/export/xlsx";
import { exportLeaveReport } from "@/lib/jml/reports/leave/registry";
import { jml, query, requireAnywhere } from "@/lib/jml/route";
import { leaveReportFilterSchema } from "@/lib/validations/jml/report";

/** Excel: the aggregate or one row per case; financial columns opt-in and permission-gated. */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      requireAnywhere(actor, "jml.viewReports");
      const filters = query(req, leaveReportFilterSchema);
      const buffer = await exportLeaveReport(actor, params.slug!, filters);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          ...xlsxDownloadHeaders(`${params.slug}${filters.detail ? "-cases" : ""}.xlsx`),
          "X-Withheld-Columns": filters.includeFinancial ? "" : "grossTotal,netTotal,provisional",
        },
      });
    }),
  ),
  { id: "jml-export", limit: 60, windowMs: 60_000 },
);
