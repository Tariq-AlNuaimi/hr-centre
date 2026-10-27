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
  /// Red-team F8 — the denominator of the figure beside it. `null` is "unknown"
  /// (a score run written before the column existed), never "nobody rated them".
  threeSixtyRaterCount: number | null;
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
  // §9.5 averages over however many raters arrived, so the figure to its left is
  // not always out of three. Beside it rather than folded into it: HR reads this
  // at calibration (§10), where a thin sample is a judgement, not a rule (F8).
  { title: "360 Raters", value: (r) => r.threeSixtyRaterCount },
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
      return err("The master results export is HR Super Admin only.", 403);
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
      return err("No scores have been calculated for this cycle yet.", 409);
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
        threeSixtyRaterCount: true,
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
      threeSixtyRaterCount: s.threeSixtyRaterCount,
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
      after: {
        cycleYear: cycle.year,
        rowCount: rows.length,
        auditRowCount: trail.rows.length,
        auditTrailTruncated: trail.truncated,
        format: asXlsx ? "xlsx" : "json",
      },
    });

    if (asXlsx) {
      const buffer = await buildReportWorkbook([
        toReportSheet({ sheet: `Results ${cycle.year}`, columns: COLUMNS, rows }),
        toReportSheet({ sheet: "Audit Trail", columns: TRAIL_COLUMNS, rows: trail.rows }),
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
      auditTrail: {
        // §14's mandate names the entity types; audit rows carry no cycle, so
        // this is every such event in the system, not only this cycle's.
        scope: "score, KPI and publication events across all cycles",
        truncated: trail.truncated,
        limit: TRAIL_LIMIT,
        rows: trail.rows,
      },
      totals: {
        employees: rows.length,
        adjusted: rows.filter((r) => r.adjusted).length,
        auditRows: trail.rows.length,
      },
    });
  }),
  { id: "pms-report-master", limit: 20, windowMs: 60_000 },
);

/**
 * The score/KPI/publication half of the audit log.
 *
 * ## Two honesty notes, both of which belong in the payload rather than here
 *
 * **It is bounded.** Read newest-FIRST and capped, then reversed for display, so
 * a busy system's export carries the most recent 5,000 events rather than the
 * oldest 5,000 — the opposite choice silently hands over a trail that stops
 * before anything the reader is asking about. `truncated` goes back with it, so
 * a capped export cannot read as a complete one.
 *
 * **It is not cycle-filtered.** `audit_logs` rows carry an entity id, not a
 * cycle, so this is every score-, KPI- and publication-bearing event in the
 * system rather than only this cycle's. Narrowing it would mean resolving each
 * entity id back to a cycle at export time — and an under-inclusive trail is a
 * worse failure than an over-inclusive one, because it is the one nobody
 * notices. Stated in the payload as `scope`.
 *
 * `changes` is summarised to its key names rather than dumped — the values can
 * contain the KPI text and rating comments already on the results tab, and a
 * column of raw JSON is not something a reader can use.
 */
const TRAIL_LIMIT = 5000;

async function auditTrail(): Promise<{ rows: TrailRow[]; truncated: boolean }> {
  const rows = await prisma.auditLog.findMany({
    where: { entityType: { in: TRAIL_ENTITY_TYPES } },
    take: TRAIL_LIMIT + 1,
    orderBy: { timestamp: "desc" },
    select: {
      timestamp: true,
      entityType: true,
      entityId: true,
      action: true,
      actorEmail: true,
      changes: true,
    },
  });
  const truncated = rows.length > TRAIL_LIMIT;
  return {
    truncated,
    // Oldest-first for reading, after taking the newest slice.
    rows: rows
      .slice(0, TRAIL_LIMIT)
      .reverse()
      .map((r) => ({
        at: r.timestamp,
        entityType: r.entityType,
        entityId: r.entityId,
        action: r.action,
        actor: r.actorEmail,
        detail:
          r.changes && typeof r.changes === "object" && !Array.isArray(r.changes)
            ? Object.keys(r.changes).join(", ")
            : "",
      })),
  };
}
