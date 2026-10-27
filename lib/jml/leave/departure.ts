import { auditedTransaction, prisma } from "@/lib/prisma";
import { applyDeparture } from "@/lib/pms/departure";
import { revokeLoginOnOffboard } from "@/lib/pms/offboarding";
import { utcDate } from "@/lib/working-time/calendar";

/**
 * The departure milestones (D7), through the core functions: the login is
 * revoked once the Last Physical Working Day has ENDED, and the departure is
 * applied once the Last Day of Service has ended — `Employee.lastWorkingDay`
 * = the LDS, reports roll up (§12.1). Migrated history never departs anyone.
 * Idempotent: each milestone is stamped on the case and never repeated.
 */

type Outcome = { caseId: string; done: boolean; note: string };

async function revokeLeaverLogin(caseId: string): Promise<Outcome> {
  return auditedTransaction(async (tx) => {
    const d = await tx.leaveCaseDetail.findUniqueOrThrow({
      where: { caseId },
      select: { loginRevokedAt: true, case: { select: { employeeId: true } } },
    });
    if (d.loginRevokedAt) return { caseId, done: false, note: "already revoked" };
    const revoked = await revokeLoginOnOffboard(tx, d.case.employeeId);
    await tx.leaveCaseDetail.update({
      where: { caseId },
      data: { loginRevokedAt: new Date() },
      select: { caseId: true },
    });
    return { caseId, done: true, note: revoked ? "login revoked" : "no login to revoke" };
  });
}

export async function applyLeaverDeparture(caseId: string): Promise<Outcome> {
  return auditedTransaction(
    async (tx) => {
      const d = await tx.leaveCaseDetail.findUniqueOrThrow({
        where: { caseId },
        select: {
          departureAppliedAt: true,
          lastDayOfService: true,
          case: {
            select: {
              caseRef: true,
              employee: { select: { id: true, status: true, lastWorkingDay: true } },
            },
          },
        },
      });
      if (d.departureAppliedAt) return { caseId, done: false, note: "already applied" };
      if (!d.lastDayOfService) return { caseId, done: false, note: "no last day of service" };
      const e = d.case.employee;
      const out = await applyDeparture(tx, {
        employeeId: e.id,
        lastWorkingDay: utcDate(d.lastDayOfService),
        previousStatus: e.status,
        previousLastWorkingDay: e.lastWorkingDay,
        note: `Exit ${d.case.caseRef}`,
      });
      if (!out.ok && out.reason !== "ALREADY_LEAVER") {
        await tx.leaveCaseDetail.update({
          where: { caseId },
          data: { departureNote: `Departure refused: ${out.reason}` },
          select: { caseId: true },
        });
        return { caseId, done: false, note: out.reason };
      }
      if (!out.ok) {
        // Already a leaver (e.g. recorded by the PMS leavers flow): align the date, stamp the milestone.
        await tx.employee.update({
          where: { id: e.id },
          data: { lastWorkingDay: utcDate(d.lastDayOfService) },
          select: { id: true },
        });
      }
      await tx.leaveCaseDetail.update({
        where: { caseId },
        data: {
          departureAppliedAt: new Date(),
          loginRevokedAt: new Date(),
          departureNote: out.ok
            ? `Departed; ${out.movedReportIds.length} report(s) rolled up.`
            : "Employee was already a leaver.",
        },
        select: { caseId: true },
      });
      return { caseId, done: true, note: out.ok ? "departed" : "already a leaver" };
    },
    { timeout: 30_000 },
  );
}

/** Sweep step: every live, non-migrated exit whose milestones have passed (local today). */
export async function departureMilestones(today: Date) {
  const live = { status: { in: ["ACTIVE", "AT_RISK", "PENDING_SETTLEMENT"] as never[] } };
  const toRevoke = await prisma.leaveCaseDetail.findMany({
    where: {
      migrated: false,
      loginRevokedAt: null,
      lastPhysicalWorkingDay: { lt: today },
      case: live,
    },
    select: { caseId: true },
    take: 200,
  });
  const toDepart = await prisma.leaveCaseDetail.findMany({
    where: {
      migrated: false,
      departureAppliedAt: null,
      lastDayOfService: { lt: today },
      case: live,
    },
    select: { caseId: true },
    take: 200,
  });
  const results: Outcome[] = [];
  for (const r of toRevoke) results.push(await revokeLeaverLogin(r.caseId));
  for (const r of toDepart) results.push(await applyLeaverDeparture(r.caseId));
  return {
    revoked: toRevoke.length,
    departed: toDepart.length,
    results: results.filter((r) => !r.done && r.note !== "already revoked").slice(0, 20),
  };
}
