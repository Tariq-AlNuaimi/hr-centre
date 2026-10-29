import { prisma } from "@/lib/prisma";
import type { SetUnitHeadInput } from "@/lib/validations/org";
import { OrgRuleError } from "./rules";

/**
 * Unit heads (overnight item 2; UX review R18 / tickets P1-5): one nullable
 * `headEmployeeId` on each company, directorate, department and team. The org
 * chart shows it, and HR tickets' org-structure tool reads it instead of the
 * free-text leader names HIVE kept in `hive_org_unit_info`.
 *
 * A head must be a current employee (not a leaver, not deleted). They need not
 * sit inside the unit — a director can be on another company's payroll — so the
 * only rule is that the person exists and is still with the group. Each write
 * goes through the normal client, so the audit extension records it.
 *
 * @public
 */

const HEAD_SELECT = { head: { select: { id: true, name: true, jobTitle: true } } } as const;

export type UnitHead = { id: string; name: string; jobTitle: string | null } | null;

async function assertEligible(employeeId: string | null) {
  if (!employeeId) return;
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, deletedAt: null },
    select: { status: true },
  });
  if (!employee) throw new OrgRuleError("headEmployeeId: that employee does not exist", 400);
  if (employee.status === "LEAVER") {
    throw new OrgRuleError("headEmployeeId: a leaver cannot head a unit", 400);
  }
}

/** Set (or clear) a unit's head. 404 when the unit does not exist or is retired. */
export async function setUnitHead(input: SetUnitHeadInput): Promise<{ head: UnitHead }> {
  await assertEligible(input.headEmployeeId);
  const where = { id: input.unitId, deletedAt: null };
  const data = { headEmployeeId: input.headEmployeeId };
  const missing = () => new OrgRuleError("That unit does not exist", 404);
  switch (input.kind) {
    case "COMPANY": {
      if (!(await prisma.orgEntity.findFirst({ where, select: { id: true } }))) throw missing();
      return prisma.orgEntity.update({ where: { id: input.unitId }, data, select: HEAD_SELECT });
    }
    case "DIRECTORATE": {
      if (!(await prisma.directorate.findFirst({ where, select: { id: true } }))) throw missing();
      return prisma.directorate.update({ where: { id: input.unitId }, data, select: HEAD_SELECT });
    }
    case "DEPARTMENT": {
      if (!(await prisma.department.findFirst({ where, select: { id: true } }))) throw missing();
      return prisma.department.update({ where: { id: input.unitId }, data, select: HEAD_SELECT });
    }
    case "TEAM": {
      if (!(await prisma.team.findFirst({ where, select: { id: true } }))) throw missing();
      return prisma.team.update({ where: { id: input.unitId }, data, select: HEAD_SELECT });
    }
  }
}
