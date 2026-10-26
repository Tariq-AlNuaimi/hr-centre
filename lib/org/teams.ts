import { prisma } from "@/lib/prisma";
import type { CreateTeamInput, UpdateTeamInput } from "@/lib/validations/org";
import { OrgRuleError, retireRefusal } from "./rules";
import { ACTIVE_ROWS, plural } from "./units";

/**
 * Teams — blueprint §1 (F-a). Split from units.ts only to keep each file
 * readable; the same rules apply: refuse first with a sentence, the composite
 * FK `employees_team_department_agree_fkey` is the backstop.
 */

const TEAM_SELECT = {
  id: true,
  name: true,
  departmentId: true,
  department: { select: { id: true, name: true, entity: { select: { code: true } } } },
} as const;

async function assertTeamNameFree(departmentId: string, name: string, exceptId?: string) {
  const clash = await prisma.team.findFirst({
    where: { departmentId, name, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new OrgRuleError(`This department already has a team called "${name}"`);
  const retired = await prisma.team.findFirst({
    where: { departmentId, name, deletedAt: { not: null } },
    select: { id: true },
  });
  if (retired) {
    throw new OrgRuleError(
      `A retired team called "${name}" exists — restore it from the recycling bin instead`,
    );
  }
}

async function assertDepartmentExists(departmentId: string) {
  const department = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { id: true },
  });
  if (!department) throw new OrgRuleError("departmentId: that department does not exist", 400);
}

export async function createTeam(input: CreateTeamInput) {
  await assertDepartmentExists(input.departmentId);
  await assertTeamNameFree(input.departmentId, input.name);
  return prisma.team.create({ data: input, select: TEAM_SELECT });
}

/** A team moves department only while empty — its people belong to the old one. */
export async function updateTeam(id: string, input: UpdateTeamInput) {
  const current = await prisma.team.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      departmentId: true,
      _count: { select: { employees: ACTIVE_ROWS } },
    },
  });
  if (!current) throw new OrgRuleError("That team does not exist", 404);
  const departmentId = input.departmentId ?? current.departmentId;
  const moving = departmentId !== current.departmentId;
  if (moving && current._count.employees > 0) {
    throw new OrgRuleError(
      `This team has ${current._count.employees} ${plural(current._count.employees, "person", "people")} ` +
        `in it, and they belong to its current department. Move them first, or create a new team there.`,
    );
  }
  if (moving) await assertDepartmentExists(departmentId);
  const name = input.name ?? current.name;
  if (name !== current.name || moving) await assertTeamNameFree(departmentId, name, id);
  return prisma.team.update({
    where: { id },
    data: { name, departmentId },
    select: TEAM_SELECT,
  });
}

export async function retireTeam(id: string) {
  const current = await prisma.team.findUnique({
    where: { id },
    select: { id: true, _count: { select: { employees: ACTIVE_ROWS } } },
  });
  if (!current) throw new OrgRuleError("That team does not exist", 404);
  const refusal = retireRefusal("team", { people: current._count.employees });
  if (refusal) throw new OrgRuleError(refusal);
  await prisma.team.delete({ where: { id } });
}

/**
 * AC-F1.2 for every employee writer (form, import, Odoo sync): a team, when
 * given, must belong to the employee's department. Returns the problem rather
 * than throwing so the import can report it per row.
 */
export async function teamPlacementProblem(
  teamId: string | null,
  departmentId: string | null,
): Promise<string | null> {
  if (!teamId) return null;
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { departmentId: true },
  });
  if (!team) return "teamId: that team does not exist";
  if (team.departmentId !== departmentId) {
    return "teamId: that team belongs to a different department";
  }
  return null;
}
