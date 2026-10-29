import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { computeBonus } from "./bonus";
import { decryptSalary } from "@/lib/core/employee-select";
import { BAND_COEFFICIENT } from "./scoring";
import type { SheetColumn } from "@/lib/core/export/xlsx";

/**
 * §11.7's payroll dataset, built once and served two ways.
 *
 * The JSON report (§13.5's "Bonus report") and the Excel export are the SAME
 * rows — the export is a rendering, not a second computation. Two code paths
 * producing "the bonus" would eventually disagree, and the one that disagrees
 * silently is the one payroll pays from.
 *
 * The authority check is NOT here. §11.6 restricts this data to HR and the
 * executive viewers, and the route enforces it before calling — keeping the
 * check at the boundary rather than duplicating it in the data layer, where a
 * future caller could forget it. Nothing here is reachable except through a
 * route that has already checked.
 */

export type BonusRow = {
  employeeId: string;
  name: string;
  department: string | null;
  entity: string | null;
  basicSalary: string | null;
  rawBand: string;
  finalBand: string;
  coefficient: number;
  workDays: number;
  effectiveMonths: string;
  eligible: boolean;
  ineligibleReason: string | null;
  bonus: string | null;
};

export async function bonusRows(params: {
  cycleId: string;
  year: number;
}): Promise<BonusRow[] | null> {
  const { cycleId, year } = params;

  const runs = await prisma.scoreRun.findMany({
    where: { cycleId },
    take: 1,
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  if (runs.length === 0) return null;

  const scores = await prisma.employeeScore.findMany({
    where: { scoreRunId: runs[0].id },
    take: 4000,
    select: {
      rawBand: true,
      calibratedBand: true,
      employee: {
        select: {
          id: true,
          odooId: true,
          name: true,
          dateOfJoining: true,
          lastWorkingDay: true,
          unpaidLeaveDays: true,
          basicSalaryEnc: true,
          department: { select: { name: true } },
          entity: { select: { code: true } },
        },
      },
    },
  });

  // §2 — the cycle is the calendar performance year.
  const cycleStart = new Date(Date.UTC(year, 0, 1));
  const cycleEnd = new Date(Date.UTC(year, 11, 31));

  return scores.map((s) => {
    const e = s.employee;
    // ADR-067 — the salary is encrypted at rest, bound to the employee's odooId.
    const salary = e.basicSalaryEnc ? decryptSalary(e.basicSalaryEnc, e.odooId) : null;
    const base = {
      employeeId: e.odooId,
      name: e.name,
      department: e.department?.name ?? null,
      entity: e.entity?.code ?? null,
      basicSalary: salary,
      rawBand: s.rawBand,
      finalBand: s.calibratedBand,
    };

    // §3.3's Date of Joining anchors both §11.2's gate and §11.4's pro-ration.
    // Without it there is no honest figure to produce, so the row is returned
    // FLAGGED rather than computed from a guess — §11.7 wants ineligible and
    // unprocessable people visible, not omitted.
    if (e.dateOfJoining === null) {
      return {
        ...base,
        coefficient: BAND_COEFFICIENT[s.calibratedBand],
        workDays: 0,
        effectiveMonths: "0.00",
        eligible: false,
        ineligibleReason:
          "No Date of Joining on file — the eligibility gate and pro-ration cannot be computed.",
        bonus: null,
      };
    }

    const bonus = computeBonus({
      band: s.calibratedBand,
      basicSalary: salary,
      work: {
        cycleStart,
        cycleEnd,
        dateOfJoining: e.dateOfJoining,
        lastWorkingDay: e.lastWorkingDay,
        unpaidLeaveDays: e.unpaidLeaveDays,
      },
    });

    return {
      ...base,
      coefficient: bonus.coefficient,
      workDays: bonus.workDays,
      effectiveMonths: bonus.effectiveMonths,
      eligible: bonus.eligible,
      ineligibleReason: bonus.ineligibleReason,
      bonus: bonus.amount,
    };
  });
}

/**
 * §11.7's stated contents, in the order the clause lists them:
 *
 * "Employee ID, name, department/entity, basic salary, final band, coefficient,
 * work days, computed pro-rated bonus. Ineligible employees are included and
 * flagged (with reason: under 6 months)."
 *
 * The two trailing columns are that flag. `rawBand` is NOT on this sheet: §11.3
 * pays from the calibrated band, and putting the raw one next to it on a
 * payroll file invites someone downstream to reconcile the difference.
 */
export type BonusTotals = {
  /** The payroll figure, as a fixed-3 string — Omani rial carries 3 decimals. */
  total: string;
  eligible: number;
  ineligible: number;
  employees: number;
};

/**
 * §13.6's "bonus totals" — the one sum of the bonus.
 *
 * Lives beside `bonusRows` rather than in a route because BOTH the executive
 * dashboard and the §13.5 bonus report show this figure, and they were each
 * computing it their own way: the dashboard folded `Prisma.Decimal` server-side,
 * the report re-summed `Number(row.bonus)` in the browser. Two independent sums
 * of the same money, one of them in binary floating point — the exact thing the
 * schema's "Decimal not Float: these are summed" comment forbids, and the exact
 * thing the dashboard's own comment warned would "eventually disagree".
 *
 * Folding once, here, is what makes that warning true rather than aspirational.
 */
export function bonusTotals(rows: readonly Pick<BonusRow, "bonus" | "eligible">[]): BonusTotals {
  let total = new Prisma.Decimal(0);
  let eligible = 0;
  for (const row of rows) {
    if (row.bonus !== null) total = total.plus(row.bonus);
    if (row.eligible) eligible += 1;
  }
  return {
    total: total.toFixed(3),
    eligible,
    ineligible: rows.length - eligible,
    employees: rows.length,
  };
}

export const BONUS_EXPORT_COLUMNS: ReadonlyArray<SheetColumn<BonusRow>> = [
  { title: "Employee ID", value: (r) => r.employeeId },
  { title: "Name", width: 28, value: (r) => r.name },
  { title: "Department", width: 22, value: (r) => r.department },
  { title: "Entity", value: (r) => r.entity },
  { title: "Basic Salary", value: (r) => r.basicSalary },
  { title: "Final Band", width: 18, value: (r) => r.finalBand },
  { title: "Coefficient", value: (r) => r.coefficient },
  { title: "Work Days", value: (r) => r.workDays },
  { title: "Effective Months", value: (r) => r.effectiveMonths },
  { title: "Pro-rated Bonus", value: (r) => r.bonus },
  { title: "Eligible", value: (r) => (r.eligible ? "Yes" : "No") },
  { title: "Ineligible Reason", width: 44, value: (r) => r.ineligibleReason },
];
