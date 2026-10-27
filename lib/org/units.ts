import { auditedTransaction, prisma } from "@/lib/prisma";
import type {
  CreateDirectorateInput,
  CreateOrgDepartmentInput,
  UpdateOrgDepartmentInput,
} from "@/lib/validations/org";
import { OrgRuleError, departmentPlacementProblem, retireRefusal } from "./rules";

/**
 * The org-unit service — blueprint §1 (F-a): company → directorate → department
 * → team.
 *
 * Every write to the structure goes through here so the "same company" and
 * "retire refused while people are assigned" rules are stated once. The database
 * enforces the placement rules too (composite FKs in migration 20261026120000);
 * this layer exists to refuse FIRST, with a sentence a person can act on rather
 * than a constraint name.
 *
 * Retiring is a soft delete (the recycling bin can restore it). It is refused
 * with a count while anything still hangs off the unit (AC-F1.3).
 */

const COMPANY_SELECT = { id: true, code: true, name: true } as const;

/**
 * Relation counts are NOT filtered by the soft-delete extension (it only sees
 * top-level queries), so "how many people are in this unit" must say so, or an
 * erroneous record deleted last month would block a retire forever.
 */
export const ACTIVE_ROWS = { where: { deletedAt: null } } as const;

// --- Companies -------------------------------------------------------------

/** Companies are rename-only: their codes are the import keys (blueprint §1). */
export async function renameCompany(id: string, name: string) {
  const company = await prisma.orgEntity.findUnique({ where: { id }, select: { id: true } });
  if (!company) throw new OrgRuleError("That company does not exist", 404);
  return prisma.orgEntity.update({ where: { id }, data: { name }, select: COMPANY_SELECT });
}

// --- Directorates ----------------------------------------------------------

const DIRECTORATE_SELECT = {
  id: true,
  name: true,
  entityId: true,
  entity: { select: COMPANY_SELECT },
} as const;

async function assertDirectorateNameFree(entityId: string, name: string, exceptId?: string) {
  // Retired rows count too: the unique index covers them, and a retired
  // directorate is restored from the recycling bin rather than recreated.
  const clash = await prisma.directorate.findFirst({
    where: { entityId, name, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new OrgRuleError(`This company already has a directorate called "${name}"`);
  const retired = await prisma.directorate.findFirst({
    where: { entityId, name, deletedAt: { not: null } },
    select: { id: true },
  });
  if (retired) {
    throw new OrgRuleError(
      `A retired directorate called "${name}" exists — restore it from the recycling bin instead`,
    );
  }
}

export async function createDirectorate(input: CreateDirectorateInput) {
  const company = await prisma.orgEntity.findUnique({
    where: { id: input.entityId },
    select: { id: true },
  });
  if (!company) throw new OrgRuleError("entityId: that company does not exist", 400);
  await assertDirectorateNameFree(input.entityId, input.name);
  return prisma.directorate.create({ data: input, select: DIRECTORATE_SELECT });
}

export async function renameDirectorate(id: string, name: string) {
  const current = await prisma.directorate.findUnique({
    where: { id },
    select: { id: true, entityId: true },
  });
  if (!current) throw new OrgRuleError("That directorate does not exist", 404);
  await assertDirectorateNameFree(current.entityId, name, id);
  return prisma.directorate.update({ where: { id }, data: { name }, select: DIRECTORATE_SELECT });
}

export async function retireDirectorate(id: string) {
  const current = await prisma.directorate.findUnique({
    where: { id },
    select: { id: true, _count: { select: { departments: ACTIVE_ROWS } } },
  });
  if (!current) throw new OrgRuleError("That directorate does not exist", 404);
  const refusal = retireRefusal("directorate", { departments: current._count.departments });
  if (refusal) throw new OrgRuleError(refusal);
  await prisma.directorate.delete({ where: { id } });
}

// --- Departments -----------------------------------------------------------

const DEPARTMENT_SELECT = {
  id: true,
  name: true,
  entityId: true,
  directorateId: true,
  entity: { select: COMPANY_SELECT },
  directorate: { select: { id: true, name: true } },
} as const;

async function loadDirectorate(directorateId: string | null) {
  if (!directorateId) return null;
  const directorate = await prisma.directorate.findUnique({
    where: { id: directorateId },
    select: { id: true, entityId: true },
  });
  if (!directorate) throw new OrgRuleError("directorateId: that directorate does not exist", 400);
  return directorate;
}

async function assertDepartmentNameFree(entityId: string, name: string, exceptId?: string) {
  const clash = await prisma.department.findFirst({
    where: { entityId, name, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new OrgRuleError(`This company already has a department called "${name}"`);
  const retired = await prisma.department.findFirst({
    where: { entityId, name, deletedAt: { not: null } },
    select: { id: true },
  });
  if (retired) {
    throw new OrgRuleError(
      `A retired department called "${name}" exists — restore it from the recycling bin instead`,
    );
  }
}

export async function createOrgDepartment(input: CreateOrgDepartmentInput) {
  const company = await prisma.orgEntity.findUnique({
    where: { id: input.entityId },
    select: { id: true },
  });
  if (!company) throw new OrgRuleError("entityId: that company does not exist", 400);
  const directorate = await loadDirectorate(input.directorateId);
  const problem = departmentPlacementProblem({ entityId: input.entityId, directorate });
  if (problem) throw new OrgRuleError(problem, 400);
  await assertDepartmentNameFree(input.entityId, input.name);
  return prisma.department.create({ data: input, select: DEPARTMENT_SELECT });
}

/**
 * Rename, re-parent under a directorate, or move to another company.
 *
 * Moving company is refused while the department has people (AC-F1.1): every
 * employee row carries the company denormalised, and their reporting lines,
 * cycle participation and scores are company-scoped — that is a transfer of
 * each person, not a property of the department. Moving company without naming a
 * directorate drops the old one, because it cannot belong to the new company.
 */
export async function updateOrgDepartment(id: string, input: UpdateOrgDepartmentInput) {
  const current = await prisma.department.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      entityId: true,
      directorateId: true,
      _count: { select: { employees: ACTIVE_ROWS } },
    },
  });
  if (!current) throw new OrgRuleError("That department does not exist", 404);

  const entityId = input.entityId ?? current.entityId;
  const movingCompany = entityId !== current.entityId;
  if (movingCompany && current._count.employees > 0) {
    throw new OrgRuleError(
      `This department has ${current._count.employees} ${plural(current._count.employees, "person", "people")} ` +
        `in it. Move them to another department first — a department cannot change company while it has people.`,
    );
  }
  if (movingCompany) {
    const company = await prisma.orgEntity.findUnique({
      where: { id: entityId },
      select: { id: true },
    });
    if (!company) throw new OrgRuleError("entityId: that company does not exist", 400);
  }

  const directorateId =
    input.directorateId !== undefined
      ? input.directorateId
      : movingCompany
        ? null
        : current.directorateId;
  const directorate = await loadDirectorate(directorateId);
  const problem = departmentPlacementProblem({ entityId, directorate });
  if (problem) throw new OrgRuleError(problem, 400);

  const name = input.name ?? current.name;
  if (name !== current.name || movingCompany) await assertDepartmentNameFree(entityId, name, id);

  return prisma.department.update({
    where: { id },
    data: { name, entityId, directorateId },
    select: DEPARTMENT_SELECT,
  });
}

/** Refused while anyone is in it; its (empty) teams retire with it. */
export async function retireOrgDepartment(id: string) {
  const current = await prisma.department.findUnique({
    where: { id },
    select: { id: true, _count: { select: { employees: ACTIVE_ROWS } } },
  });
  if (!current) throw new OrgRuleError("That department does not exist", 404);
  const refusal = retireRefusal("department", { people: current._count.employees });
  if (refusal) throw new OrgRuleError(refusal);
  await auditedTransaction(async (tx) => {
    // Teams can only hold people of this department, and it has none, so every
    // team under it is empty — retire them alongside rather than orphaning them.
    const teams = await tx.team.findMany({
      where: { departmentId: id },
      select: { id: true },
      take: 500,
    });
    for (const team of teams) await tx.team.delete({ where: { id: team.id } });
    await tx.department.delete({ where: { id } });
  });
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
