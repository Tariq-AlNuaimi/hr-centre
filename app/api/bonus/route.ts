import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { resolveActor } from "@/lib/pms/actor";
import { canViewCompensation } from "@/lib/pms/permissions";
import { computeBonus } from "@/lib/pms/bonus";
import { BAND_COEFFICIENT } from "@/lib/pms/scoring";
import { decryptSalary } from "@/lib/pms/employee-select";

/**
 * §11 — the bonus report and §11.7's payroll export.
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
 * the raw band." So this reads `calibratedBand`. The raw band is returned
 * alongside it for §13.5's master export, never used in the arithmetic.
 *
 * ## Ineligible people are included
 *
 * §11.7 — "Ineligible employees are included and flagged (with reason: under 6
 * months), so nothing looks accidentally omitted." An empty row is how a payroll
 * team quietly underpays someone; a flagged one is a question they can ask.
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
    const asExport = url.searchParams.get("export") === "1";

    const cycle = await prisma.performanceCycle.findUnique({
      where: { id: cycleId },
      select: { id: true, year: true },
    });
    if (!cycle) return notFound("Cycle");

    const runs = await prisma.scoreRun.findMany({
      where: { cycleId },
      take: 1,
      orderBy: { startedAt: "desc" },
      select: { id: true },
    });
    if (runs.length === 0) {
      return err("No scores have been calculated for this cycle yet (§10.7).", 409);
    }

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
    const cycleStart = new Date(Date.UTC(cycle.year, 0, 1));
    const cycleEnd = new Date(Date.UTC(cycle.year, 11, 31));

    const rows = scores.map((s) => {
      const e = s.employee;
      // ADR-067 — the salary is encrypted at rest, bound to the employee's
      // odooId. Decryption happens here, behind the §11.6 authority check above.
      const salary = e.basicSalaryEnc ? decryptSalary(e.basicSalaryEnc, e.odooId) : null;
      // §3.3's Date of Joining anchors both §11.2's gate and §11.4's
      // pro-ration. Without it there is no honest figure to produce, so the row
      // is returned FLAGGED rather than computed from a guess — §11.7 wants
      // ineligible and unprocessable people visible, not omitted.
      if (e.dateOfJoining === null) {
        return {
          employeeId: e.odooId,
          name: e.name,
          department: e.department?.name ?? null,
          entity: e.entity?.code ?? null,
          basicSalary: salary,
          rawBand: s.rawBand,
          finalBand: s.calibratedBand,
          coefficient: BAND_COEFFICIENT[s.calibratedBand],
          workDays: 0,
          effectiveMonths: "0.00",
          eligible: false,
          ineligibleReason:
            "No Date of Joining on file (§3.3) — the eligibility gate and pro-ration cannot be computed.",
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

      // §11.7's stated contents, in that order.
      return {
        employeeId: e.odooId,
        name: e.name,
        department: e.department?.name ?? null,
        entity: e.entity?.code ?? null,
        basicSalary: salary,
        rawBand: s.rawBand,
        finalBand: s.calibratedBand,
        coefficient: bonus.coefficient,
        workDays: bonus.workDays,
        effectiveMonths: bonus.effectiveMonths,
        eligible: bonus.eligible,
        ineligibleReason: bonus.ineligibleReason,
        bonus: bonus.amount,
      };
    });

    if (asExport) {
      // §11.7 — "HR-only action to produce; logged (who exported, when)."
      // Logged BEFORE the payload is built, so an export that is interrupted
      // still leaves the record that someone asked for it.
      await recordAudit(prisma, {
        entityType: "BonusExport",
        entityId: cycleId,
        action: "CREATE",
        after: { cycleYear: cycle.year, rowCount: rows.length },
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
