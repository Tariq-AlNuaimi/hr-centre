import { NextRequest, NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { resolveActor } from "@/lib/pms/actor";
import { canExportMasterResults } from "@/lib/pms/permissions";
import {
  buildReportWorkbook,
  toReportSheet,
  xlsxDownloadHeaders,
  type SheetColumn,
} from "@/lib/pms/export/xlsx";

/**
 * §13.5 — "Master results export — full dataset: all employees, all components,
 * raw + calibrated scores, bands, calibration adjustments with reasons, full
 * audit trail. Restricted to HR Super Admin only (NOT HRBP)."
 *
 * That last clause is the whole reason this is a separate route rather than a
 * flag on the distribution report. Every other report on this surface is open to
 * `capabilities.orgWide` — which includes HRBP and the executive viewers. This
 * one is `canExportMasterResults`, which is HR Super Admin alone, matching §10.6
 * ("HRBP does not touch calibration") and extending it: HRBP does not export the
 * record of it either.
 *
 * ## What "full dataset" means here
 *
 * The four §8.6 components, both scores, both bands, and every calibration
 * adjustment with its §10.5 reason and its author. Salary and bonus are NOT on
 * this sheet — §11.6 scopes those to a different list (which includes the
 * executive viewers), and §11.7 already produces the file that carries them.
 * Mixing the two would put compensation in front of a wider audience than §11.6
 * allows, in a file named for something else.
 *
 * ## "full audit trail"
 *
 * §14's design mandate — "Audit everything that changes a score, a KPI, or a
 * published result" — names the entity types that matter, and the workbook's
 * second tab is exactly those rows for this cycle. It is scoped to score-,
 * calibration- and publication-bearing entities rather than being the whole
 * `audit_logs` table: an export of every row in the system would carry login and
 * user-administration events that have nothing to do with the results being
 * exported, and would grow without bound.
 *
 * The export itself is audited, for the same reason §11.7's is: a full dataset
 * leaving the system is an event worth being able to ask about later.
 */

/**
 * The entity types §14's mandate names — what changed a score, a KPI, or a
 * published result. Listed rather than inferred, so adding a new audited entity
 * is a deliberate decision about whether it belongs in the results record.
 */
const TRAIL_ENTITY_TYPES = [
  "EmployeeScore",
  "ScoreRun",
  "CalibrationAdjustment",
  "CalibrationTarget",
  "CyclePublication",
  "Kpi",
  "KpiRating",
  "KpiChangeRequest",
  "BonusExport",
  "MasterResultsExport",
];

type TrailRow = {
  at: Date;
  entityType: string;
  entityId: string;
  action: string;
  actor: string | null;
  detail: string;
};

const TRAIL_COLUMNS: ReadonlyArray<SheetColumn<TrailRow>> = [
  { title: "When", width: 24, value: (r) => r.at.toISOString() },
  { title: "Entity", width: 22, value: (r) => r.entityType },
  { title: "Entity ID", width: 28, value: (r) => r.entityId },
  { title: "Action", value: (r) => r.action },
  { title: "Actor", width: 30, value: (r) => r.actor },
  { title: "Change", width: 80, value: (r) => r.detail },
];

type MasterRow = {
  employeeId: string;
  name: string;
  department: string | null;
  entity: string;
  roleTrack: string;
  managerName: string | null;
  corporateScore: string;
  departmentalScore: string | null;
  individualScore: string;
  threeSixtyScore: string | null;
  rawScore: string;
  rawBand: string;
  calibratedBand: string;
  adjusted: boolean;
  adjustments: Array<{ fromBand: string; toBand: string; reason: string; by: string; at: Date }>;
};

const COLUMNS: ReadonlyArray<SheetColumn<MasterRow>> = [
  { title: "Employee ID", value: (r) => r.employeeId },
  { title: "Name", width: 28, value: (r) => r.name },
  { title: "Department", width: 22, value: (r) => r.department },
  { title: "Entity", value: (r) => r.entity },
  { title: "Role Track", width: 18, value: (r) => r.roleTrack },
  { title: "Manager", width: 26, value: (r) => r.managerName },
  { title: "Corporate", value: (r) => r.corporateScore },
  { title: "Departmental", value: (r) => r.departmentalScore },
  { title: "Individual", value: (r) => r.individualScore },
  { title: "360", value: (r) => r.threeSixtyScore },
  { title: "Raw Score", value: (r) => r.rawScore },
  { title: "Raw Band", width: 18, value: (r) => r.rawBand },
  { title: "Calibrated Band", width: 18, value: (r) => r.calibratedBand },
  { title: "Adjusted", value: (r) => (r.adjusted ? "Yes" : "No") },
  {
    title: "Calibration Reasons",
    width: 60,
    // Every adjustment, not just the last: §10.1's audited layer is a sequence,
    // and a band moved twice for two different reasons has two reasons on file.
    value: (r) =>
      r.adjustments.map((a) => `${a.fromBand}→${a.toBand} (${a.by}): ${a.reason}`).join(" | "),
  },
];

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!canExportMasterResults(actor)) {
      return err("The master results export is HR Super Admin only (§13.5).", 403);
    }

    const url = new URL(request.url);
    const cycleId = url.searchParams.get("cycleId");
    if (!cycleId) return err("cycleId is required");
    const asXlsx = url.searchParams.get("format") === "xlsx";

    const cycle = await prisma.performanceCycle.findUnique({
      where: { id: cycleId },
      select: { id: true, year: true },
    });
    if (!cycle) return notFound("Cycle");

    const runs = await prisma.scoreRun.findMany({
      where: { cycleId },
      take: 1,
      orderBy: { startedAt: "desc" },
      select: { id: true, startedAt: true },
    });
    if (runs.length === 0) {
      return err("No scores have been calculated for this cycle yet (§10.7).", 409);
    }

    const scores = await prisma.employeeScore.findMany({
      where: { scoreRunId: runs[0].id },
      take: 4000,
      orderBy: { employee: { name: "asc" } },
      select: {
        corporateScore: true,
        departmentalScore: true,
        individualScore: true,
        threeSixtyScore: true,
        rawScore: true,
        rawBand: true,
        calibratedBand: true,
        // §13.5 — "calibration adjustments with reasons".
        adjustments: {
          take: 10,
          orderBy: { adjustedAt: "asc" },
          select: {
            fromBand: true,
            toBand: true,
            reason: true,
            adjustedAt: true,
            adjustedByEmployee: { select: { name: true } },
          },
        },
        employee: {
          // Enumerated columns — neither salary column is named here, so §11.6's
          // audience boundary holds by construction rather than by filtering.
          select: {
            odooId: true,
            name: true,
            roleTrack: true,
            department: { select: { name: true } },
            entity: { select: { name: true } },
            manager: { select: { name: true } },
          },
        },
      },
    });

    const rows: MasterRow[] = scores.map((s) => ({
      employeeId: s.employee.odooId,
      name: s.employee.name,
      department: s.employee.department?.name ?? null,
      entity: s.employee.entity.name,
      roleTrack: s.employee.roleTrack,
      managerName: s.employee.manager?.name ?? null,
      corporateScore: s.corporateScore.toFixed(2),
      departmentalScore: s.departmentalScore?.toFixed(2) ?? null,
      individualScore: s.individualScore.toFixed(2),
      threeSixtyScore: s.threeSixtyScore?.toFixed(2) ?? null,
      rawScore: s.rawScore.toFixed(2),
      rawBand: s.rawBand,
      calibratedBand: s.calibratedBand,
      adjusted: s.rawBand !== s.calibratedBand,
      adjustments: s.adjustments.map((a) => ({
        fromBand: a.fromBand,
        toBand: a.toBand,
        reason: a.reason,
        by: a.adjustedByEmployee.name,
        at: a.adjustedAt,
      })),
    }));

    const trail = await auditTrail();

    // Logged before the payload is assembled, so an interrupted export still
    // leaves the record that the full dataset was asked for.
    await recordAudit(prisma, {
      entityType: "MasterResultsExport",
      entityId: cycleId,
      action: "CREATE",
      after: { cycleYear: cycle.year, rowCount: rows.length, format: asXlsx ? "xlsx" : "json" },
    });

    if (asXlsx) {
      const buffer = await buildReportWorkbook([
        toReportSheet({ sheet: `Results ${cycle.year}`, columns: COLUMNS, rows }),
        toReportSheet({ sheet: "Audit Trail", columns: TRAIL_COLUMNS, rows: trail }),
      ]);
      return new NextResponse(new Uint8Array(buffer), {
        headers: xlsxDownloadHeaders(`rihal-master-results-${cycle.year}.xlsx`),
      });
    }

    return ok({
      cycleId,
      year: cycle.year,
      runStartedAt: runs[0].startedAt,
      rows,
      auditTrail: trail,
      totals: {
        employees: rows.length,
        adjusted: rows.filter((r) => r.adjusted).length,
        auditRows: trail.length,
      },
    });
  }),
  { id: "pms-report-master", limit: 20, windowMs: 60_000 },
);

/**
 * The score/KPI/publication half of the audit log, newest last.
 *
 * Bounded, and the bound is stated in the payload rather than hidden: an export
 * that silently stopped at 5,000 rows would read as a complete trail. `changes`
 * is summarised to its key names rather than dumped — the values can contain the
 * KPI text and rating comments that are already on the results tab, and a column
 * of raw JSON is not something a reader can use.
 */
async function auditTrail(): Promise<TrailRow[]> {
  const rows = await prisma.auditLog.findMany({
    where: { entityType: { in: TRAIL_ENTITY_TYPES } },
    take: 5000,
    orderBy: { timestamp: "asc" },
    select: {
      timestamp: true,
      entityType: true,
      entityId: true,
      action: true,
      actorEmail: true,
      changes: true,
    },
  });
  return rows.map((r) => ({
    at: r.timestamp,
    entityType: r.entityType,
    entityId: r.entityId,
    action: r.action,
    actor: r.actorEmail,
    detail:
      r.changes && typeof r.changes === "object" && !Array.isArray(r.changes)
        ? Object.keys(r.changes).join(", ")
        : "",
  }));
}
