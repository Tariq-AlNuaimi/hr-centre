import { NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden } from "@/lib/api-response";
import { holdsAnywhere } from "@/lib/hiring/access";
import { listEvaluations } from "@/lib/hiring/evaluations";
import { hiringRoute, parseQuery } from "@/lib/hiring/route";
import { buildReportSheet, xlsxDownloadHeaders } from "@/lib/core/export/xlsx";
import { evaluationListQuerySchema } from "@/lib/validations/hiring/interview";

/** Scorecards to Excel (≤ 10,000): candidate, requisition, panelist, vote, status. No written comments. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      if (!holdsAnywhere(actor, "hiring.manage")) return forbidden();
      const q = parseQuery(req, evaluationListQuerySchema.omit({ page: true, pageSize: true }));
      if ("response" in q) return q.response;
      const { data } = await listEvaluations(actor, { ...q.data, page: 1, pageSize: 10_000 });
      type Row = (typeof data)[number];
      const human = (v: string | null) =>
        v ? v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ") : "";
      const buffer = await buildReportSheet<Row>({
        sheet: "Scorecards",
        rows: data,
        columns: [
          { title: "Candidate", width: 28, value: (r) => r.candidate.name },
          { title: "Requisition", width: 32, value: (r) => r.interview.requisition.title },
          { title: "Round", width: 14, value: (r) => human(r.interview.round) },
          { title: "Panelist", width: 24, value: (r) => r.panelist?.name ?? "" },
          { title: "Vote", width: 16, value: (r) => human(r.vote) },
          { title: "Submitted", width: 12, value: (r) => (r.submitted ? "Yes" : "No") },
          { title: "Created", width: 14, value: (r) => r.createdAt.toISOString().slice(0, 10) },
        ],
      });
      return new NextResponse(new Uint8Array(buffer), {
        headers: xlsxDownloadHeaders("scorecards.xlsx"),
      });
    }),
  ),
  { id: "hiring-export", limit: 20, windowMs: 60_000 },
);
