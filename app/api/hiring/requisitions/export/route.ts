import { NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden } from "@/lib/api-response";
import { holdsAnywhere } from "@/lib/hiring/access";
import { listRequisitions } from "@/lib/hiring/requisitions";
import { hiringRoute, parseQuery } from "@/lib/hiring/route";
import { buildReportSheet, xlsxDownloadHeaders } from "@/lib/pms/export/xlsx";
import { requisitionListQuerySchema } from "@/lib/validations/hiring/requisition";

/** Requisitions to Excel (≤10,000; never pay): Title, Department, Company, Status, HM, Close date, Created. */
type Row = Awaited<ReturnType<typeof listRequisitions>>["data"][number];
const day = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      if (!holdsAnywhere(actor, "hiring.manage")) return forbidden();
      const q = parseQuery(req, requisitionListQuerySchema);
      if ("response" in q) return q.response;
      const { data } = await listRequisitions(actor, q.data, { skip: 0, take: 10_000 });
      const buffer = await buildReportSheet<Row>({
        sheet: "Requisitions",
        rows: data,
        columns: [
          { title: "Title", width: 32, value: (r) => r.title },
          { title: "Department", width: 22, value: (r) => r.departmentName ?? "" },
          { title: "Company", width: 22, value: (r) => r.entity?.name ?? "" },
          { title: "Status", width: 18, value: (r) => r.status },
          { title: "Hiring manager", width: 24, value: (r) => r.hiringManager?.name ?? "" },
          { title: "Target close date", width: 16, value: (r) => day(r.targetCloseDate) },
          { title: "Created", width: 14, value: (r) => day(r.createdAt) },
        ],
      });
      return new NextResponse(new Uint8Array(buffer), {
        headers: xlsxDownloadHeaders("requisitions.xlsx"),
      });
    }),
  ),
  { id: "hiring-export", limit: 20, windowMs: 60_000 },
);
