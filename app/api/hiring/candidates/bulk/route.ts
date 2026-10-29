import { NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden, ok } from "@/lib/api-response";
import { holdsAnywhere } from "@/lib/hiring/access";
import { bulkStageMove, exportRows } from "@/lib/hiring/candidate-bulk";
import { candidateSheet } from "@/lib/hiring/candidate-export";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { xlsxDownloadHeaders } from "@/lib/core/export/xlsx";
import { bulkActionSchema } from "@/lib/validations/hiring/candidate";

/** Bulk stage move (governed moves skipped) or export of a selection (≤500). */
export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      if (!holdsAnywhere(actor, "hiring.manage")) return forbidden();
      const body = await parseBody(req, bulkActionSchema);
      if ("response" in body) return body.response;
      if (body.data.action === "stage_move") {
        return ok(await bulkStageMove(actor, body.data.candidateIds, body.data.stage));
      }
      const buffer = await candidateSheet(await exportRows(actor, { ids: body.data.candidateIds }));
      return new NextResponse(new Uint8Array(buffer), {
        headers: xlsxDownloadHeaders("candidates-selected.xlsx"),
      });
    }),
  ),
  { id: "hiring-bulk", limit: 10, windowMs: 60_000 },
);
