import type { Prisma } from "@/generated/prisma/client";
import type { auditedTransaction } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { splitWindows } from "./transfer";

/**
 * §12.3 — the transfer split as one reusable step, extracted from
 * `POST /api/transfers` so a completed JML mover (docs/blueprints/jml.md D9)
 * applies a department/entity change through exactly the same logic.
 *
 * In the caller's transaction: two `EmployeeAssignmentPeriod` rows (old
 * position to the day before, new position from the transfer date), every
 * existing KPI attached to the old period, the employee moved, one explicit
 * audit row. Refusals are the caller's — this function assumes the employee is
 * enrolled in the cycle and the year is not already split.
 */

type Tx = Parameters<Parameters<typeof auditedTransaction>[0]>[0];

export type TransferEmployee = {
  id: string;
  departmentId: string | null;
  entityId: string;
  managerId: string | null;
};

export type TransferSplitInput = {
  employee: TransferEmployee;
  cycleId: string;
  participantId: string;
  windows: NonNullable<ReturnType<typeof splitWindows>>;
  transferDate: Date;
  newDepartmentId: string | null;
  newEntityId: string;
  /** `undefined` = the line is unchanged; `null` = no manager. */
  newManagerEmployeeId: string | null | undefined;
  /** Further employee fields changed in the same move (team, job title…). */
  extra?: Prisma.EmployeeUncheckedUpdateInput;
  /** Why it was recorded (e.g. without a mover case) — written to the audit row. */
  note?: string | null;
};

export async function splitAndMove(tx: Tx, p: TransferSplitInput) {
  const { employee, windows } = p;
  const managerAfter =
    p.newManagerEmployeeId === undefined ? employee.managerId : p.newManagerEmployeeId;
  const before = await tx.employeeAssignmentPeriod.create({
    data: {
      employeeId: employee.id,
      cycleId: p.cycleId,
      departmentId: employee.departmentId,
      entityId: employee.entityId,
      managerEmployeeId: employee.managerId,
      startsOn: windows.before.startsOn,
      endsOn: windows.before.endsOn,
      orderIndex: 0,
    },
    select: { id: true },
  });
  const after = await tx.employeeAssignmentPeriod.create({
    data: {
      employeeId: employee.id,
      cycleId: p.cycleId,
      departmentId: p.newDepartmentId,
      entityId: p.newEntityId,
      managerEmployeeId: managerAfter,
      startsOn: windows.after.startsOn,
      endsOn: windows.after.endsOn,
      orderIndex: 1,
    },
    select: { id: true },
  });
  const attached = await tx.kpi.updateMany({
    where: { participantId: p.participantId, deletedAt: null, assignmentPeriodId: null },
    data: { assignmentPeriodId: before.id },
  });
  await tx.employee.update({
    where: { id: employee.id },
    data: {
      ...p.extra,
      departmentId: p.newDepartmentId,
      entityId: p.newEntityId,
      ...(p.newManagerEmployeeId !== undefined ? { managerId: p.newManagerEmployeeId } : {}),
    },
  });
  await recordAudit(tx, {
    entityType: "Employee",
    entityId: employee.id,
    action: "UPDATE",
    before: {
      departmentId: employee.departmentId,
      entityId: employee.entityId,
      managerId: employee.managerId,
    },
    after: {
      departmentId: p.newDepartmentId,
      entityId: p.newEntityId,
      managerId: managerAfter,
      transferDate: p.transferDate,
      cycleId: p.cycleId,
      kpisAttachedToOldPeriod: attached.count,
      ...(p.note ? { note: p.note } : {}),
    },
  });
  return { beforeId: before.id, afterId: after.id, attached: attached.count };
}

/**
 * Where a transfer on `transferDate` would split the employee's year: the
 * cycle of that calendar year they are enrolled in, unless the year is already
 * split. A reason instead when there is nothing to split.
 */
export type TransferPlan =
  | { reason: string }
  | {
      cycleId: string;
      participantId: string;
      windows: NonNullable<ReturnType<typeof splitWindows>>;
    };

export async function transferPlan(
  tx: Tx,
  employeeId: string,
  transferDate: Date,
): Promise<TransferPlan> {
  const year = transferDate.getUTCFullYear();
  const cycle = await tx.performanceCycle.findFirst({
    where: { year, participants: { some: { employeeId } } },
    select: { id: true, year: true },
  });
  if (!cycle) return { reason: `not enrolled in a ${year} performance cycle` };
  const windows = splitWindows({
    cycleStart: new Date(Date.UTC(year, 0, 1)),
    cycleEnd: new Date(Date.UTC(year, 11, 31)),
    transferDate,
  });
  if (!windows) return { reason: `the date does not split ${year}` };
  const [participant, existing] = await Promise.all([
    tx.cycleParticipant.findUnique({
      where: { cycleId_employeeId: { cycleId: cycle.id, employeeId } },
      select: { id: true },
    }),
    tx.employeeAssignmentPeriod.count({ where: { employeeId, cycleId: cycle.id } }),
  ]);
  if (!participant) return { reason: `not enrolled in the ${year} cycle` };
  if (existing > 0) {
    return { reason: `the ${year} performance year is already split — HR splits it manually` };
  }
  return { cycleId: cycle.id, participantId: participant.id, windows };
}
