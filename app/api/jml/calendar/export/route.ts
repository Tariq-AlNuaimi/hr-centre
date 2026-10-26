import { NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { buildReportSheet, xlsxDownloadHeaders } from "@/lib/pms/export/xlsx";
import { jml, query, requireAnywhere } from "@/lib/jml/route";
import { joiningCalendar, type CalendarEntry } from "@/lib/jml/watch/calendar";
import { calendarSchema } from "@/lib/validations/jml/case";

/** The joining calendar as Excel (§12 columns). */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireAnywhere(actor, "jml.view");
      const { entries } = await joiningCalendar(actor, query(req, calendarSchema));
      const buffer = await buildReportSheet<CalendarEntry>({
        sheet: "Joining dates",
        rows: entries,
        columns: [
          { title: "Joining date", value: (e) => e.date },
          { title: "Weekend", value: (e) => (e.onWeekend ? "Yes" : "No") },
          { title: "Confirmed", value: (e) => (e.confirmed ? "Yes" : "No") },
          { title: "Employee", value: (e) => e.fullName },
          { title: "Employee code", value: (e) => e.employeeCode },
          { title: "Job title", value: (e) => e.jobTitle },
          { title: "Company", value: (e) => e.company },
          { title: "Status", value: (e) => e.status },
        ],
      });
      return new NextResponse(new Uint8Array(buffer), {
        headers: xlsxDownloadHeaders("joining-calendar.xlsx"),
      });
    }),
  ),
  { id: "jml-export", limit: 10, windowMs: 60_000 },
);
