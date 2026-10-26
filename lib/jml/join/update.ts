import type { Prisma } from "@/generated/prisma/client";
import { auditedTransaction } from "@/lib/prisma";
import { encryptSalary } from "@/lib/pms/employee-select";
import { existingLoginEmails, provisionLoginFor } from "@/lib/pms/import/run";
import { isPlaceholderEmail } from "@/lib/people/provisional-id";
import { recordWriteData } from "@/lib/people/write";
import type { ScopeSubject } from "@/lib/rbac/grants";
import type { UpdateJoinerInput } from "@/lib/validations/jml/joiner";
import { canFor, type JmlActor } from "../access";
import { JmlError } from "../errors";
import {
  assertReferences,
  detailData,
  loadJoinerForEdit,
  requireManage,
  requireSalaryIfGiven,
} from "./draft";
import {
  joinerSubject,
  loadJoinerRow,
  placementSubject,
  serializeJoiner,
  type JoinerRow,
} from "./joiner-data";

/** Editing a joiner (Onboarding new-hire PATCH) — split from draft.ts. */

async function targetSubject(row: JoinerRow, input: UpdateJoinerInput): Promise<ScopeSubject> {
  const e = row.employee;
  const moved =
    input.entityId !== undefined ||
    input.departmentId !== undefined ||
    input.teamId !== undefined ||
    input.roleTrack !== undefined;
  if (!moved) return joinerSubject(e);
  return placementSubject({
    entityId: input.entityId ?? e.entityId,
    departmentId: input.departmentId !== undefined ? input.departmentId : e.departmentId,
    teamId: input.teamId !== undefined ? input.teamId : e.teamId,
    roleTrack: input.roleTrack ?? e.roleTrack,
  });
}

function nextEmail(row: JoinerRow, workEmail: string | null | undefined): string | undefined {
  if (workEmail === undefined) return undefined;
  if (workEmail !== null) return workEmail;
  if (isPlaceholderEmail(row.employee.email)) return undefined;
  throw new JmlError("A work email cannot be removed once it is on file.", 409);
}

function employeeData(row: JoinerRow, input: UpdateJoinerInput) {
  const e = row.employee;
  const data: Prisma.EmployeeUncheckedUpdateInput = recordWriteData(
    {
      jobTitle: input.jobTitle,
      contractType: input.employmentType,
      workLocation: input.workLocation,
      personalEmail: input.personalEmail,
      personalPhone: input.phone,
      nationality: input.nationality,
    },
    e.odooId,
  );
  const email = nextEmail(row, input.workEmail);
  if (input.fullName !== undefined) data.name = input.fullName;
  if (email !== undefined) data.email = email;
  if (input.entityId !== undefined) data.entityId = input.entityId;
  if (input.departmentId !== undefined) data.departmentId = input.departmentId;
  if (input.teamId !== undefined) data.teamId = input.teamId;
  if (input.roleTrack !== undefined) data.roleTrack = input.roleTrack;
  if (input.managerId !== undefined) data.managerId = input.managerId;
  if (input.salary !== undefined) data.basicSalaryEnc = encryptSalary(input.salary, e.odooId);
  if (input.plannedStartDate !== undefined && e.status === "PRE_JOINER") {
    data.dateOfJoining = input.plannedStartDate;
  }
  return data;
}

/**
 * Edit a joiner (§9.5: every field stays editable after activation). Onboarding
 * 8.4.11 fixed: once the case is active the planned start moves only through
 * "Change start date", which shifts the tasks and tells IT/PRO/the manager.
 */
export async function updateJoiner(actor: JmlActor, caseId: string, input: UpdateJoinerInput) {
  const row = await loadJoinerForEdit(actor, caseId);
  if (input.expectedVersion !== undefined && input.expectedVersion !== row.version) {
    throw new JmlError("Someone else changed this joiner. Reload and try again.", 409);
  }
  const planned = row.joinDetail?.plannedStartDate?.toISOString().slice(0, 10) ?? null;
  const asked = input.plannedStartDate?.toISOString().slice(0, 10) ?? null;
  if (input.plannedStartDate !== undefined && row.status !== "DRAFT" && asked !== planned) {
    throw new JmlError("Use Change start date to move an active onboarding's start.", 409);
  }
  const subject = await targetSubject(row, input);
  requireManage(actor, subject);
  requireSalaryIfGiven(actor, joinerSubject(row.employee), input.salary);
  if (input.salary !== undefined && !canFor(actor, "people.viewSalary", subject)) {
    throw new JmlError("You cannot record salary for this joiner.", 403);
  }
  await assertReferences({ ...input, employeeId: row.employee.id });
  await auditedTransaction(async (tx) => {
    const data = employeeData(row, input);
    if (Object.keys(data).length > 0) {
      await tx.employee.update({ where: { id: row.employee.id }, data, select: { id: true } });
    }
    const detail = detailData(input);
    if (Object.keys(detail).length > 0) {
      await tx.jmlJoinDetail.update({ where: { caseId }, data: detail, select: { caseId: true } });
    }
    await tx.jmlCase.update({
      where: { id: caseId, version: row.version },
      data: { version: { increment: 1 }, lastUpdatedById: actor.userId },
      select: { id: true },
    });
    await provisionLoginIfDue(tx, row, typeof data.email === "string" ? data.email : null);
  });
  return serializeJoiner(await loadJoinerRow(caseId), actor);
}

type Tx = Parameters<Parameters<typeof auditedTransaction>[0]>[0];

/** An ACTIVE joiner whose work address has just been issued gets their login now. */
async function provisionLoginIfDue(tx: Tx, row: JoinerRow, newEmail: string | null) {
  const e = row.employee;
  if (!newEmail || e.status !== "ACTIVE" || e.userId) return;
  const taken = await existingLoginEmails(tx, [newEmail]);
  const userId = await provisionLoginFor(
    tx,
    { email: newEmail, name: e.name, status: "ACTIVE" },
    taken,
  );
  if (userId) {
    await tx.employee.update({ where: { id: e.id }, data: { userId }, select: { id: true } });
  }
}
