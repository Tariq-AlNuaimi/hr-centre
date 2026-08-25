import { NextRequest, NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { resolveActor } from "@/lib/pms/actor";
import { canViewCompensation } from "@/lib/pms/permissions";
import { BONUS_EXPORT_COLUMNS, bonusRows } from "@/lib/pms/bonus-report";
import { buildReportSheet, xlsxDownloadHeaders } from "@/lib/pms/export/xlsx";

/**
 * §11 — the bonus report and §11.7's payroll Excel export.
 *
 * ## Who may see this
 *
 * §11.6 and §4.5 agree: "Salary and bonus figures are visible only to HR (Super
 * Admin + HRBP), COO, and Ops Director." `canViewCompensation` is that list, and
 * a line manager is deliberately not on it — not even for their own reports.
 *
 * ## The band is the CALIBRATED one
 *
 * §11.3 — "Bonus is always computed from the calibrated (post-curve) band, never
 * the raw band." The arithmetic lives in `lib/pms/bonus-report.ts`, which the
 * JSON view and the .xlsx export both read, so the number payroll receives is
 * the number the screen showed.
 *
 * ## Two representations, one dataset
 *
 * `?format=xlsx` returns the workbook §11.7 asks for; without it the same rows
 * come back as JSON for the on-screen report (§13.5). Both are logged when they
 * are an EXPORT — §11.7: "HR-only action to produce; logged (who exported,
 * when)."
 */

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!canViewCompensation(actor)) {
      return err("Bonus figures are visible to HR and the executive viewers (§4.5, §11.6).", 403);
    }

    const url = new URL(request.url);
    const cycleId = url.searchParams.get("cycleId");
    if (!cycleId) return err("cycleId is required");
    const asXlsx = url.searchParams.get("format") === "xlsx";
    // `export=1` predates the xlsx format and still means "record that this was
    // taken away from the screen". An .xlsx download always is one.
    const asExport = asXlsx || url.searchParams.get("export") === "1";

    const cycle = await prisma.performanceCycle.findUnique({
      where: { id: cycleId },
      select: { id: true, year: true },
    });
    if (!cycle) return notFound("Cycle");

    const rows = await bonusRows({ cycleId, year: cycle.year });
    if (rows === null) {
      return err("No scores have been calculated for this cycle yet (§10.7).", 409);
    }

    if (asExport) {
      // §11.7 — "logged (who exported, when)". Written BEFORE the workbook is
      // built, so an export that is interrupted still leaves the record that
      // someone asked for it. `recordAudit` stamps the actor and the time.
      await recordAudit(prisma, {
        entityType: "BonusExport",
        entityId: cycleId,
        action: "CREATE",
        after: { cycleYear: cycle.year, rowCount: rows.length, format: asXlsx ? "xlsx" : "json" },
      });
    }

    if (asXlsx) {
      const buffer = await buildReportSheet({
        sheet: `Bonus ${cycle.year}`,
        columns: BONUS_EXPORT_COLUMNS,
        rows,
      });
      return new NextResponse(new Uint8Array(buffer), {
        headers: xlsxDownloadHeaders(`rihal-bonus-${cycle.year}.xlsx`),
      });
    }

    const totals = rows.reduce(
      (acc, r) => ({
        eligible: acc.eligible + (r.eligible ? 1 : 0),
        ineligible: acc.ineligible + (r.eligible ? 0 : 1),
      }),
      { eligible: 0, ineligible: 0 },
    );

    return ok({ cycleId, year: cycle.year, rows, totals, exported: asExport });
  }),
  { id: "pms-bonus-read", limit: 30, windowMs: 60_000 },
);
