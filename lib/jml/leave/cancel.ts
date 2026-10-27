import { auditedTransaction, prisma } from "@/lib/prisma";
import { reverseDeparture } from "@/lib/pms/departure";
import { loadCaseFor, type JmlActor } from "../access";
import { cancelOpenWork } from "../engine/case-actions";
import { generateReversalTasks } from "../engine/generate";
import { JmlError } from "../errors";
import { isLive } from "../vocab";
import { noticeToOwners } from "./notices";

/**
 * Withdraw an exit (Offboarding cancel route, AC-2.1/2.3, T10). One
 * transaction: open tasks cancelled; one REV-<code> task (mandatory, blocking,
 * `reversalOfId` SET — F13) per completed revocation; if the departure was
 * already applied it is undone through the core `reverseDeparture`, and a
 * login revoked at the LPWD is restored. Archive is then refused until every
 * reversal task is settled (lib/jml/engine/case-actions.ts).
 */

export async function cancelLeave(
  actor: JmlActor,
  caseId: string,
  input: { reason: string; expectedVersion: number },
) {
  const kase = await loadCaseFor(actor, caseId, "jml.manageLeavers", "LEAVE");
  if (kase.version !== input.expectedVersion)
    throw new JmlError("Someone else changed this case. Reload and try again.", 409);
  if (kase.status !== "DRAFT" && !isLive(kase.status)) {
    throw new JmlError(`This exit case is already ${kase.status.toLowerCase()}.`, 409);
  }
  const detail = await prisma.leaveCaseDetail.findUnique({
    where: { caseId },
    select: { departureAppliedAt: true, loginRevokedAt: true },
  });
  const completed = await prisma.jmlTask.findMany({
    where: { caseId, status: "COMPLETED", reversalFlag: true },
    select: { id: true, code: true, name: true, status: true, reversalFlag: true },
    take: 200,
  });
  const reversals = generateReversalTasks(completed, "LEAVE");
  const idByCode = new Map(completed.map((t) => [t.code, t.id]));
  const result = await auditedTransaction(
    async (tx) => {
      const cancelled = await cancelOpenWork(tx, caseId, `${kase.caseRef} withdrawn`);
      let order = 9000;
      for (const r of reversals) {
        await tx.jmlTask.create({
          data: {
            caseId,
            code: r.code,
            name: r.name,
            stage: r.stage,
            sortOrder: order++,
            source: "REVERSAL",
            mandatory: true,
            blocking: true,
            isReversal: true,
            reversalOfId: idByCode.get(r.reversalOfCode)!,
            dueDate: new Date(),
            ownerUserId: kase.hrOwnerUserId,
          },
          select: { id: true },
        });
      }
      let departureReversed = false;
      if (detail?.departureAppliedAt) {
        const out = await reverseDeparture(tx, {
          employeeId: kase.employeeId,
          note: `${kase.caseRef} withdrawn: ${input.reason}`,
        });
        departureReversed = out.ok;
      } else if (detail?.loginRevokedAt) {
        await restoreLogin(tx, kase.employeeId);
      }
      await tx.leaveCaseDetail.update({
        where: { caseId },
        data: { departureAppliedAt: null, loginRevokedAt: null },
        select: { caseId: true },
      });
      await tx.jmlCase.update({
        where: { id: caseId, version: kase.version },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelReason: input.reason,
          lastUpdatedById: actor.userId,
          version: { increment: 1 },
        },
        select: { id: true },
      });
      return { cancelledTasks: cancelled, reversalTasks: reversals.length, departureReversed };
    },
    { timeout: 20_000 },
  );
  if (reversals.length > 0) {
    await noticeToOwners(
      caseId,
      "JML_INFO",
      `${kase.caseRef} was withdrawn: ${reversals.length} reversal task${reversals.length === 1 ? "" : "s"} must be worked before it can be archived.`,
      "withdrawn",
    );
  }
  return result;
}

type Tx = Parameters<Parameters<typeof auditedTransaction>[0]>[0];

/** Undo an LPWD login revocation (the soft delete), when the departure itself never applied. */
async function restoreLogin(tx: Tx, employeeId: string) {
  const emp = await tx.employee.findUnique({ where: { id: employeeId }, select: { userId: true } });
  if (!emp?.userId) return false;
  const user = await tx.user.findFirst({
    where: { id: emp.userId, deletedAt: { not: null } },
    select: { id: true },
  });
  if (!user) return false;
  await tx.user.update({
    where: { id: user.id },
    data: { deletedAt: null, deletedBy: null },
    select: { id: true },
  });
  return true;
}
