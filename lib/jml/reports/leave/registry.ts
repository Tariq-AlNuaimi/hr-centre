import { buildReportWorkbook, toReportSheet } from "@/lib/core/export/xlsx";
import type { LeaveReportFilters } from "@/lib/validations/jml/report";
import { canFor, holdsAnywhere, subjectOf, type JmlActor } from "../../access";
import { JmlError } from "../../errors";
import { openMoney } from "../../money/crypto";
import { r2Attrition, r5Early, r8Omanisation } from "./attrition";
import { loadLeaveRows, orgNames, unsuppressed, type LeaveReport, type LeaveRow } from "./base";
import { r6Active, r7Settlement } from "./process";
import { r1Reasons, r3Regrettable, r4Managers } from "./reasons";
import { SMALL_CELL_THRESHOLD, type Cell } from "./rules";

/**
 * Offboarding Module 16 — R1 to R8, in order (a contract test pins it), with
 * an Excel export: the aggregate, or one row per case. Financial columns are
 * opt-in and `jml.financialReports` only; the narrative is never exported.
 */
const LEAVE_REPORTS: readonly LeaveReport[] = [
  r1Reasons,
  r2Attrition,
  r3Regrettable,
  r4Managers,
  r5Early,
  r6Active,
  r7Settlement,
  r8Omanisation,
];

function findLeaveReport(slug: string): LeaveReport {
  const r = LEAVE_REPORTS.find((x) => x.slug === slug);
  if (!r) throw new JmlError("Report not found", 404);
  return r;
}

export async function runLeaveReport(actor: JmlActor, slug: string, filters: LeaveReportFilters) {
  const report = findLeaveReport(slug);
  return { slug, title: report.title, ...(await report.run({ actor, filters, now: new Date() })) };
}

const MASKED = "(below reporting threshold)";
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** One row per case; a line manager with fewer than 4 exits in the set has the identifying columns masked. */
async function detailRows(
  actor: JmlActor,
  rows: readonly LeaveRow[],
  includeFinancial: boolean,
): Promise<Cell[]> {
  const names = await orgNames(rows);
  const perManager = new Map<string, number>();
  for (const r of rows) {
    const k = r.leaveDetail.lineManagerEmployeeId ?? "—";
    perManager.set(k, (perManager.get(k) ?? 0) + 1);
  }
  const mask = !unsuppressed(actor);
  return rows.map((r) => {
    const small =
      mask &&
      (perManager.get(r.leaveDetail.lineManagerEmployeeId ?? "—") ?? 0) < SMALL_CELL_THRESHOLD;
    return { ...caseRow(r, names, small), ...(includeFinancial ? financialCols(r) : {}) };
  });
}

type Names = Awaited<ReturnType<typeof orgNames>>;

function caseRow(r: LeaveRow, names: Names, small: boolean): Cell {
  const d = r.leaveDetail;
  const masked = (v: string | null | undefined) => (small ? MASKED : (v ?? null));
  return {
    caseRef: r.caseRef,
    employeeName: d.employeeNameAtExit,
    company: names.entity.get(d.entityIdAtExit) ?? null,
    department: d.departmentIdAtExit ? (names.department.get(d.departmentIdAtExit) ?? null) : null,
    lineManager: masked(d.lineManager?.name),
    hrOwner: r.hrOwner?.name ?? null,
    exitType: d.exitType,
    employmentType: d.employmentTypeAtExit,
    nationality: d.nationality,
    status: r.status,
    stage: r.stage,
    migrated: d.migrated ? "Yes" : "No",
    noticeStartDate: day(d.noticeStartDate),
    lastPhysicalWorkingDay: day(d.lastPhysicalWorkingDay),
    lastDayOfService: day(d.lastDayOfService),
    closedAt: day(r.closedAt),
    primaryL1: masked(r.interview?.primaryL1),
    primaryL2Code: masked(r.interview?.primaryL2Code),
    regrettable: masked(r.interview?.regrettable),
  };
}

function financialCols(r: LeaveRow): Cell {
  const raw = r.settlement?.figuresEnc
    ? openMoney("settlement", r.id, "figures", r.settlement.figuresEnc)
    : null;
  const f = raw
    ? (JSON.parse(raw) as { grossTotalAmount?: number; netTotalAmount?: number })
    : null;
  return {
    grossTotal: f?.grossTotalAmount ?? null,
    netTotal: f?.netTotalAmount ?? null,
    provisional: r.settlement ? (r.settlement.provisional ? "Yes" : "No") : null,
  };
}

function sheetOf(name: string, columns: { key: string; title: string }[], rows: readonly Cell[]) {
  return toReportSheet<Cell>({
    sheet: name.slice(0, 31),
    columns: columns.map((c) => ({
      title: c.title,
      width: Math.max(c.title.length + 4, 14),
      value: (row) => row[c.key] ?? null,
    })),
    rows,
  });
}

export async function exportLeaveReport(
  actor: JmlActor,
  slug: string,
  filters: LeaveReportFilters,
) {
  const financial = Boolean(filters.includeFinancial);
  if (financial && !holdsAnywhere(actor, "jml.financialReports")) {
    throw new JmlError("Financial columns are exported by HR users who may see settlements.", 403);
  }
  const provenance = (rows: number) =>
    sheetOf(
      "About",
      [
        { key: "k", title: "Item" },
        { key: "v", title: "Value" },
      ],
      [
        { k: "Report", v: findLeaveReport(slug).title },
        {
          k: "Filters",
          v: JSON.stringify({ ...filters, detail: undefined, includeFinancial: undefined }),
        },
        { k: "Financial columns", v: financial ? "Included" : "Withheld" },
        { k: "Rows", v: rows },
        { k: "Generated at", v: new Date().toISOString() },
        { k: "Generated by", v: actor.userId },
      ],
    );
  if (filters.detail) {
    const { rows } = await loadLeaveRows({ actor, filters, now: new Date() });
    const visible = financial
      ? rows.filter((r) =>
          canFor(
            actor,
            "jml.viewSettlement",
            subjectOf({
              entityId: r.leaveDetail.entityIdAtExit,
              departmentId: r.leaveDetail.departmentIdAtExit,
              department: { directorateId: r.leaveDetail.directorateIdAtExit },
            }),
          ),
        )
      : rows;
    const cells = await detailRows(actor, financial ? visible : rows, financial);
    const keys = Object.keys(cells[0] ?? { caseRef: null });
    return buildReportWorkbook([
      sheetOf(
        "Cases",
        keys.map((k) => ({ key: k, title: k })),
        cells,
      ),
      provenance(cells.length),
    ]);
  }
  const result = await runLeaveReport(actor, slug, filters);
  const summary = result.summary.map((s) => ({ measure: s.label, value: s.value }));
  return buildReportWorkbook([
    sheetOf(slug, result.columns, result.cells),
    sheetOf(
      "Summary",
      [
        { key: "measure", title: "Measure" },
        { key: "value", title: "Value" },
      ],
      summary,
    ),
    provenance(result.cells.length),
  ]);
}
