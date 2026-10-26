import { NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden } from "@/lib/api-response";
import { holdsAnywhere } from "@/lib/hiring/access";
import { calendarRows } from "@/lib/hiring/interview-views";
import { hiringRoute, parseQuery } from "@/lib/hiring/route";
import { buildReportSheet, xlsxDownloadHeaders } from "@/lib/pms/export/xlsx";
import { calendarQuerySchema } from "@/lib/validations/hiring/interview";

/** Interviews to Excel: who, which requisition, round, when, status, where. No notes or transcripts. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      if (!holdsAnywhere(actor, "hiring.manage")) return forbidden();
      const q = parseQuery(req, calendarQuerySchema);
      if ("response" in q) return q.response;
      type Row = Awaited<ReturnType<typeof calendarRows>>[number];
      const human = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");
      const buffer = await buildReportSheet<Row>({
        sheet: "Interviews",
        rows: await calendarRows(actor, q.data),
        columns: [
          { title: "Candidate", width: 28, value: (r) => r.candidate.name },
          { title: "Requisition", width: 32, value: (r) => r.requisition.title },
          { title: "Round", width: 14, value: (r) => human(r.round) },
          {
            title: "Scheduled",
            width: 18,
            value: (r) => r.scheduledDate.toISOString().slice(0, 16).replace("T", " "),
          },
          { title: "Status", width: 14, value: (r) => human(r.status) },
          { title: "Location", width: 24, value: (r) => r.location ?? "" },
          { title: "Panel", width: 40, value: (r) => r.panelists.map((p) => p.name).join(", ") },
        ],
      });
      return new NextResponse(new Uint8Array(buffer), {
        headers: xlsxDownloadHeaders("interviews.xlsx"),
      });
    }),
  ),
  { id: "hiring-export", limit: 20, windowMs: 60_000 },
);
