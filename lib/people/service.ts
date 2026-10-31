import { auditedTransaction, prisma } from "@/lib/prisma";
import { OrgRuleError } from "@/lib/org/rules";
import { teamPlacementProblem } from "@/lib/org/teams";
import { existingLoginEmails, provisionLoginFor } from "@/lib/pms/import/run";
import type { CreateEmployeeInput } from "@/lib/validations/employee";
import type { EmployeeRecordInput } from "./record";
import { employeeCreateData, recordWriteData } from "./write";
import { resolveGradeCode } from "@/lib/core/catalogue/grades";

/**
 * HR Centre F-b — the form paths onto the one writer (lib/people/write.ts).
 *
 * "Adding one employee by form produces exactly what the import would"
 * (AC-F5.2): same data builder, same passwordless login provisioning
 * (ADR-069), same placement rules — refused here with a field-named sentence,
 * and by the database's composite FKs underneath.
 */

const day = (v: string | null) => (v ? new Date(`${v}T00:00:00Z`) : null);

async function placementProblem(input: CreateEmployeeInput): Promise<string | null> {
  if (input.departmentId) {
    const department = await prisma.department.findUnique({
      where: { id: input.departmentId },
      select: { entityId: true },
    });
    if (!department) return "departmentId: that department does not exist";
    if (department.entityId !== input.entityId) {
      return "departmentId: that department belongs to a different company";
    }
  } else {
    const company = await prisma.orgEntity.findUnique({
      where: { id: input.entityId },
      select: { id: true },
    });
    if (!company) return "entityId: that company does not exist";
  }
  const team = await teamPlacementProblem(input.teamId ?? null, input.departmentId);
  if (team) return team;
  if (input.managerId) {
    const manager = await prisma.employee.findUnique({
      where: { id: input.managerId },
      select: { id: true },
    });
    if (!manager) return "managerId: that employee does not exist";
  }
  return null;
}

/**
 * ADR-103: the form sends a grade code; it must be in the catalogue for the
 * employee's company (or group-wide). Undefined = not sent; null = cleared.
 */
async function gradeFor(record: EmployeeRecordInput, entityId: string) {
  if (record.grade === undefined) return undefined;
  const r = await resolveGradeCode(record.grade, entityId);
  if ("problem" in r) throw new OrgRuleError(`grade: ${r.problem}`, 400);
  return r.gradeId;
}

export async function createEmployeeFromForm(
  input: CreateEmployeeInput,
  record: EmployeeRecordInput,
): Promise<{ id: string }> {
  const [byId, byEmail] = await Promise.all([
    prisma.employee.findUnique({ where: { odooId: input.odooId }, select: { id: true } }),
    prisma.employee.findUnique({ where: { email: input.email }, select: { id: true } }),
  ]);
  if (byId) throw new OrgRuleError(`odooId: employee ID "${input.odooId}" is already on file`);
  if (byEmail)
    throw new OrgRuleError(`email: "${input.email}" already belongs to another employee`);
  const problem = await placementProblem(input);
  if (problem) throw new OrgRuleError(problem, 400);
  const grade = await gradeFor(record, input.entityId);

  return auditedTransaction(async (tx) => {
    const taken = await existingLoginEmails(tx, [input.email]);
    const userId = await provisionLoginFor(tx, input, taken);
    return tx.employee.create({
      data: employeeCreateData(
        {
          odooId: input.odooId,
          name: input.name,
          email: input.email,
          departmentId: input.departmentId,
          teamId: input.teamId ?? null,
          entityId: input.entityId,
          roleTrack: input.roleTrack,
          basicSalary: input.basicSalary,
          status: input.status,
          dateOfJoining: day(input.dateOfJoining),
          lastWorkingDay: day(input.lastWorkingDay),
          unpaidLeaveDays: input.unpaidLeaveDays,
        },
        record,
        { userId, managerId: input.managerId, gradeId: grade },
      ),
      select: { id: true },
    });
  });
}

/** Partial update of the record fields only (job, contact, personal, ID documents). */
export async function updateEmployeeRecord(
  employeeId: string,
  record: EmployeeRecordInput,
): Promise<void> {
  const target = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { odooId: true, entityId: true },
  });
  if (!target) throw new OrgRuleError("That employee does not exist", 404);
  const data = recordWriteData(record, target.odooId, await gradeFor(record, target.entityId));
  if (Object.keys(data).length === 0) return;
  await prisma.employee.update({ where: { id: employeeId }, data, select: { id: true } });
}
