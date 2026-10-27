import { NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden } from "@/lib/api-response";
import { holdsAnywhere } from "@/lib/hiring/access";
import { listOffers } from "@/lib/hiring/offers";
import { hiringRoute, parseQuery } from "@/lib/hiring/route";
import { buildReportSheet, xlsxDownloadHeaders } from "@/lib/pms/export/xlsx";
import { offerListQuerySchema } from "@/lib/validations/hiring/offer";

/** Offers to Excel (≤ 10,000). No pay — the column set is fixed here, not taken from the row. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      if (!holdsAnywhere(actor, "hiring.manage")) return forbidden();
      const q = parseQuery(req, offerListQuerySchema.omit({ page: true, pageSize: true }));
      if ("response" in q) return q.response;
      const { data } = await listOffers(actor, { ...q.data, page: 1, pageSize: 10_000 });
      type Row = (typeof data)[number];
      const human = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");
      const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
      const buffer = await buildReportSheet<Row>({
        sheet: "Offers",
        rows: data,
        columns: [
          { title: "Candidate", width: 28, value: (r) => r.candidate.name },
          { title: "Requisition", width: 32, value: (r) => r.requisition.title },
          { title: "Status", width: 18, value: (r) => human(r.status) },
          { title: "Start date", width: 14, value: (r) => day(r.startDate) },
          { title: "Contract", width: 16, value: (r) => r.contractType ?? "" },
          { title: "Created", width: 14, value: (r) => day(r.createdAt) },
        ],
      });
      return new NextResponse(new Uint8Array(buffer), {
        headers: xlsxDownloadHeaders("offers.xlsx"),
      });
    }),
  ),
  { id: "hiring-export", limit: 20, windowMs: 60_000 },
);
