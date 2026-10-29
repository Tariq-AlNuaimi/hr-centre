import { prisma } from "@/lib/prisma";
import type { SetUnitHeadInput } from "@/lib/validations/org";
import { OrgRuleError } from "./rules";

/**
 * Unit heads (overnight item 2; UX review R18 / tickets P1-5): one nullable
 * `headEmployeeId` on each company, directorate, department and team. The org
 * chart shows it, and HR tickets' org-structure tool reads it instead of the
 * free-text leader names HIVE kept in `hive_org_unit_info`.
 *
 * A head must be a current employee (not a leaver, not deleted) of the UNIT'S
 * OWN COMPANY (QA2 N-06: a Codeline employee was accepted as head of a Rihal
 * department, so the org chart and HR tickets named someone the unit's company
 * does not employ). They need not sit inside the unit itself. Each write goes
 * through the normal client, so the audit extension records it.
 *
 * @public
 */

const HEAD_SELECT = { head: { select: { id: true, name: true, jobTitle: true } } } as const;

export type UnitHead = { id: string; name: string; jobTitle: string | null } | null;

async function assertEligible(employeeId: string | null, unitEntityId: string) {
  if (!employeeId) return;
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, deletedAt: null },
    select: { status: true, entityId: true },
  });
  if (!employee) throw new OrgRuleError("headEmployeeId: that employee does not exist", 400);
  if (employee.status === "LEAVER") {
    throw new OrgRuleError("headEmployeeId: a leaver cannot head a unit", 400);
  }
  if (employee.entityId !== unitEntityId) {
    throw new OrgRuleError(
      "headEmployeeId: the head must be an employee of the unit's own company",
      400,
    );
  }
}

/** The unit's company, or null when the unit does not exist or is retired. */
async function unitCompany(kind: SetUnitHeadInput["kind"], id: string): Promise<string | null> {
  const where = { id, deletedAt: null };
  switch (kind) {
    case "COMPANY":
      return (await prisma.orgEntity.findFirst({ where, select: { id: true } }))?.id ?? null;
    case "DIRECTORATE":
      return (
        (await prisma.directorate.findFirst({ where, select: { entityId: true } }))?.entityId ??
        null
      );
    case "DEPARTMENT":
      return (
        (await prisma.department.findFirst({ where, select: { entityId: true } }))?.entityId ?? null
      );
    case "TEAM":
      return (
        (
          await prisma.team.findFirst({
            where,
            select: { department: { select: { entityId: true } } },
          })
        )?.department.entityId ?? null
      );
  }
}

/** Set (or clear) a unit's head. 404 when the unit does not exist or is retired. */
export async function setUnitHead(input: SetUnitHeadInput): Promise<{ head: UnitHead }> {
  const entityId = await unitCompany(input.kind, input.unitId);
  if (!entityId) throw new OrgRuleError("That unit does not exist", 404);
  await assertEligible(input.headEmployeeId, entityId);
  const where = { id: input.unitId };
  const data = { headEmployeeId: input.headEmployeeId };
  switch (input.kind) {
    case "COMPANY":
      return prisma.orgEntity.update({ where, data, select: HEAD_SELECT });
    case "DIRECTORATE":
      return prisma.directorate.update({ where, data, select: HEAD_SELECT });
    case "DEPARTMENT":
      return prisma.department.update({ where, data, select: HEAD_SELECT });
    case "TEAM":
      return prisma.team.update({ where, data, select: HEAD_SELECT });
  }
}
