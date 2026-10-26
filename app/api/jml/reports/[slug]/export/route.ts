import { NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { xlsxDownloadHeaders } from "@/lib/pms/export/xlsx";
import { exportReport } from "@/lib/jml/reports/registry";
import { jml, query, requireAnywhere } from "@/lib/jml/route";
import { reportFilterSchema } from "@/lib/validations/jml/report";

/** Every report exports to Excel (§13). */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      requireAnywhere(actor, "jml.viewReports");
      const buffer = await exportReport(actor, params.slug!, query(req, reportFilterSchema));
      return new NextResponse(new Uint8Array(buffer), {
        headers: xlsxDownloadHeaders(`${params.slug}.xlsx`),
      });
    }),
  ),
  { id: "jml-export", limit: 10, windowMs: 60_000 },
);
