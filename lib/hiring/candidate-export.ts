import { buildReportSheet } from "@/lib/pms/export/xlsx";
import type { ExportRow } from "./candidate-bulk";

/**
 * The candidate export sheet (Interview Hub columns). Contact and score are
 * already blank for rows the reader may not see PII on; there is no column for
 * pay, DEI, national ID or any note, so none can leak through it.
 */

const humanize = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");
const day = (d: Date) => new Date(d).toISOString().slice(0, 10);

export function candidateSheet(rows: ExportRow[]) {
  return buildReportSheet<ExportRow>({
    sheet: "Candidates",
    rows,
    columns: [
      { title: "Name", width: 28, value: (r) => r.name },
      { title: "Email", width: 28, value: (r) => r.email ?? "" },
      { title: "Requisition", width: 32, value: (r) => r.requisition?.title ?? "" },
      { title: "Stage", width: 20, value: (r) => humanize(r.stage) },
      { title: "Source", width: 18, value: (r) => humanize(r.source) },
      { title: "Overall score", width: 14, value: (r) => r.overallScore ?? "" },
      { title: "Created", width: 14, value: (r) => day(r.createdAt) },
    ],
  });
}
