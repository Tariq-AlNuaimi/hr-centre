import { NextResponse, type NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err } from "@/lib/api-response";
import { requireHivePermission } from "@/lib/hive/services/permissions";
import { reportCsvRows, toCsv } from "@/lib/hive/services/report-sla";
import { getTicketSettings } from "@/lib/hive/services/ticket-settings";
import { reportRangeSchema } from "@/lib/validations/hive/reports";

/**
 * P2-10 — the ticket report as CSV: one row per ticket opened in the range
 * (≤ 5,000), service-level columns only. No employee name, email or question
 * text leaves through this file. Same permission as the report itself.
 */
export const GET = withRateLimit(
  withAuth(
    requireHivePermission("viewReports", async (req: NextRequest) => {
      const url = new URL(req.url);
      const parsed = reportRangeSchema.safeParse({
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
      });
      if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid range.", 400);
      const [rows, settings] = await Promise.all([reportCsvRows(parsed.data), getTicketSettings()]);
      return new NextResponse(toCsv(rows, settings.ticketPrefix), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="tickets-${parsed.data.from}-to-${parsed.data.to}.csv"`,
          "Cache-Control": "no-store, private",
        },
      });
    }),
  ),
  { id: "hive-report-export", limit: 10, windowMs: 60_000 },
);
