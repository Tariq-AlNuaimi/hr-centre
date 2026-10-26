import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { requireHivePermission } from "@/lib/hive/services/permissions";
import { getTicketReport } from "@/lib/hive/services/reports";
import { reportRangeSchema } from "@/lib/validations/hive/reports";
import { getTicketSettings } from "@/lib/hive/services/ticket-settings";

/**
 * Blueprint US-T7's reporting screen, server side.
 *
 * Gated on the View reports grant. Company-wide by design (the launch grants
 * give it with scope ALL), and safe to be: the payload is counts and HR pair
 * names, never an employee or a question (`lib/hive/services/reports.ts`).
 */
export const GET = withAuth(
  requireHivePermission("viewReports", async (req: NextRequest) => {
    const url = new URL(req.url);
    const parsed = reportRangeSchema.safeParse({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid range.", 400);
    const [report, settings] = await Promise.all([
      getTicketReport(parsed.data),
      getTicketSettings(),
    ]);
    // Labels only: the report shows no ticket IDs.
    return ok({ ...report, statusLabels: settings.statusLabels });
  }),
);
