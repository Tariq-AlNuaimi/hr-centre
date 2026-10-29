import { NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { buildReportSheet, xlsxDownloadHeaders } from "@/lib/core/export/xlsx";
import { listCases, type CaseRow } from "@/lib/jml/engine/case-read";
import { jml, query, requireAnywhere } from "@/lib/jml/route";
import { caseListSchema } from "@/lib/validations/jml/case";

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** The case list as Excel (Onboarding cases/export: ≤ 5000 rows, no salary). */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireAnywhere(actor, "jml.view");
      const { rows } = await listCases(actor, query(req, caseListSchema), {
        page: 1,
        pageSize: 5000,
        skip: 0,
        take: 5000,
      });
      const buffer = await buildReportSheet<CaseRow>({
        sheet: "Cases",
        rows,
        columns: [
          { title: "Case", value: (r) => r.caseRef },
          { title: "Type", value: (r) => r.caseType },
          { title: "Employee", value: (r) => r.employee.name },
          { title: "Employee code", value: (r) => r.employee.employeeCode },
          { title: "Company", value: (r) => r.employee.entity.name },
          { title: "Department", value: (r) => r.employee.department?.name ?? null },
          { title: "Job title", value: (r) => r.employee.jobTitle },
          { title: "Employment type", value: (r) => r.employee.contractType },
          { title: "HR owner", value: (r) => r.hrOwner?.name ?? null },
          { title: "Planned start", value: (r) => day(r.joinDetail?.plannedStartDate) },
          { title: "Actual start", value: (r) => day(r.joinDetail?.actualStartDate) },
          { title: "Stage", value: (r) => r.stage },
          { title: "Progress %", value: (r) => r.completionPct },
          { title: "Status", value: (r) => r.status },
          { title: "Activated", value: (r) => day(r.activatedAt) },
        ],
      });
      return new NextResponse(new Uint8Array(buffer), {
        headers: xlsxDownloadHeaders("jml-cases.xlsx"),
      });
    }),
  ),
  { id: "jml-export", limit: 10, windowMs: 60_000 },
);
