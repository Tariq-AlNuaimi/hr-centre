import { NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden } from "@/lib/api-response";
import { holdsAnywhere } from "@/lib/hiring/access";
import { exportRows } from "@/lib/hiring/candidate-bulk";
import { candidateSheet } from "@/lib/hiring/candidate-export";
import { hiringRoute, parseQuery } from "@/lib/hiring/route";
import { xlsxDownloadHeaders } from "@/lib/pms/export/xlsx";
import { candidateExportQuerySchema } from "@/lib/validations/hiring/candidate";

/** Candidates to Excel (≤10,000). Never pay, DEI, national ID or notes. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      if (!holdsAnywhere(actor, "hiring.manage")) return forbidden();
      const q = parseQuery(req, candidateExportQuerySchema);
      if ("response" in q) return q.response;
      const buffer = await candidateSheet(await exportRows(actor, q.data));
      return new NextResponse(new Uint8Array(buffer), {
        headers: xlsxDownloadHeaders("candidates.xlsx"),
      });
    }),
  ),
  { id: "hiring-export", limit: 20, windowMs: 60_000 },
);
