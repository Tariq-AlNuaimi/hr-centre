import type { EmployeeStatus, Prisma, RoleTrack } from "@/generated/prisma/client";
import { encryptSalary } from "@/lib/core/employee-select";
import { encryptIdNumber } from "./id-documents";
import type { EmployeeRecordInput } from "./record";

/**
 * THE employee writer — blueprint §5: "one writer: lib/people/write.ts, shared
 * by import, form and the future Odoo sync".
 *
 * It turns a natural-form employee (plain dates, plaintext salary and ID
 * numbers) into exactly the Prisma `data` the row gets, so the import and the
 * Add employee form cannot drift apart (AC-F5.2) and nothing writes a
 * Restricted column without going through its encryption crossing. Callers keep
 * their own validation (the import reports every problem across a file; a form
 * rejects on the first) and their own transaction.
 */

export type EmployeeCoreInput = {
  odooId: string;
  name: string;
  email: string;
  departmentId: string | null;
  teamId: string | null;
  entityId: string;
  roleTrack: RoleTrack;
  /** Plaintext decimal string; encrypted here (ADR-067). */
  basicSalary: string | null;
  status: EmployeeStatus;
  dateOfJoining: Date | null;
  lastWorkingDay: Date | null;
  unpaidLeaveDays: number;
};

/** The F-b record fields as Prisma data. Absent (`undefined`) keys are omitted. */
export function recordWriteData(
  input: EmployeeRecordInput,
  odooId: string,
): Prisma.EmployeeUncheckedUpdateInput {
  const data: Prisma.EmployeeUncheckedUpdateInput = {};
  const copy = <K extends keyof EmployeeRecordInput & keyof Prisma.EmployeeUncheckedUpdateInput>(
    key: K,
  ) => {
    if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
  };
  copy("jobTitle");
  copy("grade");
  copy("contractType");
  copy("probationEndDate");
  copy("workLocation");
  copy("workPhone");
  copy("personalEmail");
  copy("personalPhone");
  copy("dateOfBirth");
  copy("gender");
  copy("nationality");
  copy("civilIdExpiry");
  copy("passportExpiry");
  if (input.civilIdNumber !== undefined) {
    data.civilIdNumberEnc = encryptIdNumber(input.civilIdNumber, odooId);
  }
  if (input.passportNumber !== undefined) {
    data.passportNumberEnc = encryptIdNumber(input.passportNumber, odooId);
  }
  return data;
}

/** Everything a NEW employee row gets. The manager edge is the caller's. */
export function employeeCreateData(
  core: EmployeeCoreInput,
  record: EmployeeRecordInput,
  extra: { userId: string | null; managerId?: string | null },
): Prisma.EmployeeUncheckedCreateInput {
  const data: Prisma.EmployeeUncheckedCreateInput = {
    odooId: core.odooId,
    name: core.name,
    email: core.email,
    departmentId: core.departmentId,
    teamId: core.teamId,
    entityId: core.entityId,
    roleTrack: core.roleTrack,
    basicSalaryEnc: encryptSalary(core.basicSalary, core.odooId),
    status: core.status,
    dateOfJoining: core.dateOfJoining,
    lastWorkingDay: core.lastWorkingDay,
    unpaidLeaveDays: core.unpaidLeaveDays,
    userId: extra.userId,
    ...(extra.managerId !== undefined ? { managerId: extra.managerId } : {}),
  };
  // Record fields share their names and types between the create and update
  // inputs; the update-typed builder is the single source for both.
  return Object.assign(data, recordWriteData(record, core.odooId));
}

/**
 * An existing row's update. `status`/`lastWorkingDay` are left to the caller
 * because a departure is not a field edit (§12.1 — see lib/pms/departure.ts).
 */
export function employeeUpdateData(
  core: Omit<EmployeeCoreInput, "status" | "lastWorkingDay">,
  record: EmployeeRecordInput,
): Prisma.EmployeeUncheckedUpdateInput {
  return {
    name: core.name,
    email: core.email,
    departmentId: core.departmentId,
    teamId: core.teamId,
    entityId: core.entityId,
    roleTrack: core.roleTrack,
    basicSalaryEnc: encryptSalary(core.basicSalary, core.odooId),
    dateOfJoining: core.dateOfJoining,
    unpaidLeaveDays: core.unpaidLeaveDays,
    ...recordWriteData(record, core.odooId),
  };
}
