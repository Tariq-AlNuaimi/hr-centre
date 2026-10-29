import { auditedTransaction, prisma } from "@/lib/prisma";
import { recordImport } from "@/lib/core/imports/record";
import { zonedToday } from "@/lib/working-time/calendar";
import { loadSchedule } from "@/lib/working-time/load";
import { activeTaxonomy } from "./interview";
import { validateImport, type ImportRow, type RowProblem } from "./import-rules";

/**
 * Historical exits (§26.2): dry run by default; applying is a second,
 * deliberate act. Each row becomes a CLOSED, `migrated` LEAVE case at Stage 4
 * with no tasks — history only: it never departs anyone and is excluded from
 * process metrics (R6, R7, cycle time). F8 fixed: the coded reasons become an
 * interview row (conducted = IMPORTED), so history shows in R1/R3. Idempotent
 * by reference: an existing migrated case is skipped; a live case holding the
 * reference refuses the row.
 */

const EMPLOYEE_SELECT = {
  id: true,
  name: true,
  odooId: true,
  employeeCode: true,
  jobTitle: true,
  grade: true,
  contractType: true,
  entityId: true,
  departmentId: true,
  teamId: true,
  managerId: true,
  department: { select: { directorateId: true } },
} as const;

type Planned = { row: ImportRow; employeeId: string; action: "CREATE" | "SKIP" };

async function plan(text: string) {
  const today = zonedToday(new Date(), (await loadSchedule()).timeZone);
  const { rows, problems, fatal } = validateImport(text, today);
  if (fatal) return { fatal, planned: [] as Planned[], problems };
  const ids = [...new Set(rows.map((r) => r.employeeExternalId))];
  const employees = await prisma.employee.findMany({
    where: { OR: [{ odooId: { in: ids } }, { employeeCode: { in: ids } }] },
    select: { id: true, odooId: true, employeeCode: true },
    take: 10_000,
  });
  const byKey = new Map<string, string>();
  for (const e of employees) {
    byKey.set(e.odooId, e.id);
    if (e.employeeCode) byKey.set(e.employeeCode, e.id);
  }
  const existing = await prisma.jmlCase.findMany({
    where: { caseRef: { in: rows.map((r) => r.caseRef) } },
    select: { caseRef: true, leaveDetail: { select: { migrated: true } } },
    take: 10_000,
  });
  const refs = new Map(existing.map((c) => [c.caseRef, c.leaveDetail?.migrated ?? false]));
  const taxonomy = await activeTaxonomy();
  const out: Planned[] = [];
  const more: RowProblem[] = [...problems];
  for (const row of rows) {
    const employeeId = byKey.get(row.employeeExternalId);
    const fail = (message: string) => more.push({ line: row.line, caseRef: row.caseRef, message });
    if (!employeeId) {
      fail(`No employee has Odoo id or EMP code "${row.employeeExternalId}"`);
      continue;
    }
    if (row.primaryL2Code) {
      const code = taxonomy.find((c) => c.code === row.primaryL2Code);
      if (!code || code.level1 !== row.primaryL1) {
        fail(`primaryL2Code ${row.primaryL2Code} is not a code under ${row.primaryL1}`);
        continue;
      }
    }
    if (refs.has(row.caseRef)) {
      if (refs.get(row.caseRef)) out.push({ row, employeeId, action: "SKIP" });
      else fail(`${row.caseRef} is held by a live case`);
      continue;
    }
    out.push({ row, employeeId, action: "CREATE" });
  }
  return { fatal: null, planned: out, problems: more.sort((a, b) => a.line - b.line) };
}

export async function importHistoricalExits(
  text: string,
  commit: boolean,
  by: { userId: string; email?: string | null } | null = null,
) {
  const p = await plan(text);
  const summary = {
    fatal: p.fatal,
    toCreate: p.planned.filter((x) => x.action === "CREATE").length,
    skipped: p.planned.filter((x) => x.action === "SKIP").length,
    problems: p.problems.slice(0, 200),
    committed: false,
  };
  const applies = commit && !p.fatal && p.problems.length === 0;
  if (applies) for (const x of p.planned.filter((y) => y.action === "CREATE")) await createOne(x);
  if (by) await recordRun(summary, applies, p.planned.length + p.problems.length, by);
  return applies ? { ...summary, committed: true } : summary;
}

/** Every run (dry run or commit) on the core import record (ADR-096), for Admin › Imports. */
async function recordRun(
  summary: { fatal: string | null; toCreate: number; problems: RowProblem[] },
  applied: boolean,
  rows: number,
  by: { userId: string; email?: string | null },
) {
  await recordImport({
    kind: "jml.exits",
    filename: "historical-exits.csv",
    status: summary.fatal ? "FAILED" : applied ? "APPLIED" : "PREVIEWED",
    uploadedById: by.userId,
    uploadedByEmail: by.email ?? null,
    rowsTotal: rows,
    rowsCreated: applied ? summary.toCreate : 0,
    rowsRejected: summary.problems.length,
    issues: summary.problems.map((x) => ({
      rowNumber: x.line,
      reference: x.caseRef ?? null,
      rule: "row_invalid",
      message: x.message,
    })),
  }).catch(() => {
    // The import itself stands; only its listing is missing. Not detailed.
    console.warn("[imports] a historical exits run could not be recorded");
  });
}

async function createOne({ row, employeeId }: Planned) {
  const e = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: EMPLOYEE_SELECT,
  });
  await auditedTransaction(async (tx) => {
    const kase = await tx.jmlCase.create({
      data: {
        caseRef: row.caseRef,
        caseType: "LEAVE",
        status: "CLOSED",
        stage: "STAGE_4_SETTLEMENT",
        employeeId,
        completionPct: 100,
        closedAt: row.closedAt ?? row.lastDayOfService,
      },
      select: { id: true },
    });
    await tx.leaveCaseDetail.create({
      data: {
        caseId: kase.id,
        exitType: row.exitType as never,
        nationality: row.nationality as never,
        noticeStartDate: row.noticeStartDate,
        noticePeriodDays: 0,
        noticePeriodOverrideReason: "Historical import",
        lastPhysicalWorkingDay: row.lastPhysicalWorkingDay,
        lastDayOfService: row.lastDayOfService,
        settlementApplicable: false,
        migrated: true,
        employeeNameAtExit: e.name,
        jobTitleAtExit: e.jobTitle,
        gradeAtExit: e.grade,
        entityIdAtExit: e.entityId,
        directorateIdAtExit: e.department?.directorateId ?? null,
        departmentIdAtExit: e.departmentId,
        teamIdAtExit: e.teamId,
        employmentTypeAtExit: e.contractType,
        lineManagerEmployeeId: e.managerId,
      },
      select: { caseId: true },
    });
    if (row.primaryL1 && row.primaryL2Code) {
      await tx.leaveExitInterview.create({
        data: {
          caseId: kase.id,
          conducted: "IMPORTED",
          primaryL1: row.primaryL1 as never,
          primaryL2Code: row.primaryL2Code,
          secondaryL2Code: row.secondaryL2Code,
        },
        select: { caseId: true },
      });
    }
  });
}
