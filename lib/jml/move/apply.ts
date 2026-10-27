import type { ContractType, Prisma } from "@/generated/prisma/client";
import type { auditedTransaction } from "@/lib/prisma";
import { splitAndMove, transferPlan } from "@/lib/pms/transfer-apply";
import { JmlError } from "../errors";
import type { Snapshot } from "./profile";

/**
 * Apply a completed internal change to the employee (D9) — in the same
 * transaction as the task that completed the case, so the record and the case
 * cannot disagree. A department or company change goes through the §12.3
 * transfer split when the employee is enrolled in that year's performance
 * cycle (lib/pms/transfer-apply.ts); otherwise the placement simply moves, and
 * the case says why no split was made.
 */

type Tx = Parameters<Parameters<typeof auditedTransaction>[0]>[0];

const v = (snap: Snapshot, field: string) => snap[field]?.value ?? null;

async function assertPlacementStillValid(tx: Tx, entityId: string, departmentId: string | null) {
  if (!departmentId) return;
  const dept = await tx.department.findUnique({
    where: { id: departmentId },
    select: { entityId: true },
  });
  if (!dept || dept.entityId !== entityId) {
    throw new JmlError(
      "The new department no longer belongs to the new company, so the change cannot be applied. Cancel this case and start a new change.",
      409,
    );
  }
}

function otherFields(next: Snapshot): Prisma.EmployeeUncheckedUpdateInput {
  const data: Prisma.EmployeeUncheckedUpdateInput = {};
  if ("jobTitle" in next) data.jobTitle = v(next, "jobTitle");
  if ("employmentType" in next)
    data.contractType = v(next, "employmentType") as ContractType | null;
  if ("workLocation" in next) data.workLocation = v(next, "workLocation");
  if ("teamId" in next) data.teamId = v(next, "teamId");
  return data;
}

export async function applyMove(tx: Tx, caseId: string): Promise<void> {
  const kase = await tx.jmlCase.findUnique({
    where: { id: caseId },
    select: {
      moveDetail: { select: { newDetails: true, effectiveDate: true, appliedAt: true } },
      employee: { select: { id: true, departmentId: true, entityId: true, managerId: true } },
    },
  });
  const detail = kase?.moveDetail;
  if (!kase || !detail || detail.appliedAt) return;
  const next = detail.newDetails as Snapshot;
  const e = kase.employee;
  const placementMoves = "entityId" in next || "departmentId" in next;
  const newEntityId = (v(next, "entityId") ?? e.entityId) as string;
  const newDepartmentId = "departmentId" in next ? v(next, "departmentId") : e.departmentId;
  const newManager = "managerId" in next ? v(next, "managerId") : undefined;
  const extra = otherFields(next);
  let note = "Applied to the employee record.";
  if (placementMoves) {
    await assertPlacementStillValid(tx, newEntityId, newDepartmentId);
    const plan = await transferPlan(tx, e.id, detail.effectiveDate);
    if ("windows" in plan) {
      await splitAndMove(tx, {
        employee: e,
        cycleId: plan.cycleId,
        participantId: plan.participantId,
        windows: plan.windows,
        transferDate: detail.effectiveDate,
        newDepartmentId,
        newEntityId,
        newManagerEmployeeId: newManager,
        extra,
      });
      note = "Applied; the performance year was split at the effective date.";
    } else {
      await tx.employee.update({
        where: { id: e.id },
        data: {
          ...extra,
          entityId: newEntityId,
          departmentId: newDepartmentId,
          ...(newManager !== undefined ? { managerId: newManager } : {}),
        },
        select: { id: true },
      });
      note = `Applied; no performance split (${plan.reason}).`;
    }
  } else {
    await tx.employee.update({
      where: { id: e.id },
      data: { ...extra, ...(newManager !== undefined ? { managerId: newManager } : {}) },
      select: { id: true },
    });
  }
  if ("contractTypeId" in next) await applyContractType(tx, e.id, v(next, "contractTypeId"));
  await tx.jmlMoveDetail.update({
    where: { caseId },
    data: { appliedAt: new Date(), applyNote: note },
    select: { caseId: true },
  });
}

/** The contract type lives on the joiner details; an employee with none keeps it on the case only. */
async function applyContractType(tx: Tx, employeeId: string, contractTypeId: string | null) {
  const join = await tx.jmlCase.findFirst({
    where: {
      employeeId,
      caseType: "JOIN",
      status: { not: "CANCELLED" },
      joinDetail: { isNot: null },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!join) return;
  await tx.jmlJoinDetail.update({
    where: { caseId: join.id },
    data: { contractTypeId },
    select: { caseId: true },
  });
}
