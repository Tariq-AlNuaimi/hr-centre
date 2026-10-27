import { prisma } from "@/lib/prisma";
import { OrgRuleError } from "@/lib/org/rules";
import type { AssignmentBody, RoleBody } from "@/lib/validations/rbac";
import { validityProblem } from "./grants";
import { assertHrAccessAdminRemains } from "./guards";

/**
 * Role builder + assignments — blueprint §3 (F-c, AC-F3.1/AC-F3.2). The routes
 * that call this are platform-admin-only (`withAdminAuth`, AC-F3.3); every write
 * is audited by the Prisma audit extension.
 */

const ROLE_SELECT = {
  id: true,
  name: true,
  description: true,
  permissions: true,
  starterKey: true,
  updatedAt: true,
  _count: { select: { assignments: true } },
} as const;

export function listRoles() {
  return prisma.accessRole.findMany({
    orderBy: { name: "asc" },
    take: 200,
    select: ROLE_SELECT,
  });
}

async function assertRoleNameFree(name: string, exceptId?: string) {
  const clash = await prisma.accessRole.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new OrgRuleError(`name: a role called "${name}" already exists`);
}

export async function createRole(body: RoleBody) {
  await assertRoleNameFree(body.name);
  return prisma.accessRole.create({ data: body, select: ROLE_SELECT });
}

/** Rename / re-describe / re-tick. Takes effect on every holder's next request. */
export async function updateRole(id: string, body: RoleBody) {
  const role = await prisma.accessRole.findUnique({ where: { id }, select: { id: true } });
  if (!role) throw new OrgRuleError("That role does not exist", 404);
  await assertRoleNameFree(body.name, id);
  await assertHrAccessAdminRemains({ roleEdit: { roleId: id, permissions: body.permissions } });
  return prisma.accessRole.update({ where: { id }, data: body, select: ROLE_SELECT });
}

/** AC-F3.1 — refused while assigned, naming the holders. */
export async function deleteRole(id: string) {
  const role = await prisma.accessRole.findUnique({
    where: { id },
    select: {
      id: true,
      assignments: {
        select: { user: { select: { name: true, email: true } } },
        take: 20,
      },
      _count: { select: { assignments: true } },
    },
  });
  if (!role) throw new OrgRuleError("That role does not exist", 404);
  if (role._count.assignments > 0) {
    const names = [...new Set(role.assignments.map((a) => a.user.name ?? a.user.email))];
    const more = role._count.assignments > names.length ? " and others" : "";
    throw new OrgRuleError(
      `This role is still assigned to ${names.join(", ")}${more}. Remove those assignments first.`,
    );
  }
  await assertHrAccessAdminRemains({ deletedRoleId: id });
  await prisma.accessRole.delete({ where: { id } });
}

// --- Assignments -------------------------------------------------------------

const ASSIGNMENT_SELECT = {
  id: true,
  scopeType: true,
  scopeId: true,
  validFrom: true,
  validUntil: true,
  note: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true } },
  role: { select: { id: true, name: true } },
  grantedBy: { select: { name: true, email: true } },
} as const;

/** Name of each scoped unit, resolved in three batched reads (no N+1). */
async function scopeLabels(rows: Array<{ scopeType: string; scopeId: string | null }>) {
  const idsOf = (type: string) => [
    ...new Set(rows.filter((r) => r.scopeType === type && r.scopeId).map((r) => r.scopeId!)),
  ];
  const [companies, directorates, departments, pairs] = await Promise.all([
    prisma.orgEntity.findMany({
      where: { id: { in: idsOf("COMPANY") } },
      select: { id: true, name: true },
    }),
    prisma.directorate.findMany({
      where: { id: { in: idsOf("DIRECTORATE") } },
      select: { id: true, name: true },
    }),
    prisma.department.findMany({
      where: { id: { in: idsOf("DEPARTMENT") } },
      select: { id: true, name: true, entity: { select: { code: true } } },
    }),
    // HR tickets (HIVE port): an HR_PAIR assignment names an HR Tag pair.
    prisma.hrTagPair.findMany({
      where: { id: { in: idsOf("HR_PAIR") } },
      select: { id: true, name: true },
    }),
  ]);
  const labels = new Map<string, string>();
  for (const c of companies) labels.set(c.id, c.name);
  for (const d of directorates) labels.set(d.id, d.name);
  for (const d of departments) labels.set(d.id, `${d.entity.code} · ${d.name}`);
  for (const p of pairs) labels.set(p.id, p.name);
  return labels;
}

export async function listAssignments(
  page: { skip: number; take: number },
  filter: { roleId?: string; userId?: string } = {},
) {
  const now = new Date();
  // UX P1 R12 — a role's "Assigned to" list and one person's assignments.
  const where = {
    ...(filter.roleId ? { roleId: filter.roleId } : {}),
    ...(filter.userId ? { userId: filter.userId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.roleAssignment.findMany({
      where,
      orderBy: [{ user: { email: "asc" } }, { createdAt: "asc" }],
      skip: page.skip,
      take: page.take,
      select: ASSIGNMENT_SELECT,
    }),
    prisma.roleAssignment.count({ where }),
  ]);
  const labels = await scopeLabels(rows);
  return {
    rows: rows.map((r) => ({
      ...r,
      scopeLabel: r.scopeId ? (labels.get(r.scopeId) ?? null) : null,
      // Decided here, once, so the screen does not read the clock while rendering.
      expired: r.validUntil !== null && r.validUntil <= now,
    })),
    total,
  };
}

async function scopeUnitExists(scopeType: string, scopeId: string): Promise<boolean> {
  const where = { where: { id: scopeId }, select: { id: true } } as const;
  if (scopeType === "COMPANY") return (await prisma.orgEntity.findUnique(where)) !== null;
  if (scopeType === "DIRECTORATE") return (await prisma.directorate.findUnique(where)) !== null;
  if (scopeType === "DEPARTMENT") return (await prisma.department.findUnique(where)) !== null;
  if (scopeType === "HR_PAIR") return (await prisma.hrTagPair.findUnique(where)) !== null;
  return false;
}

export async function createAssignment(body: AssignmentBody, grantedById: string) {
  const [user, role] = await Promise.all([
    prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } }),
    prisma.accessRole.findUnique({ where: { id: body.roleId }, select: { id: true } }),
  ]);
  if (!user) throw new OrgRuleError("userId: that person has no account", 400);
  if (!role) throw new OrgRuleError("roleId: that role does not exist", 400);
  if (body.scopeId && !(await scopeUnitExists(body.scopeType, body.scopeId))) {
    throw new OrgRuleError("scopeId: that unit does not exist", 400);
  }
  const window = validityProblem(body.validFrom, body.validUntil, new Date());
  if (window) throw new OrgRuleError(window, 400);
  // An EXPIRED assignment for the same role and scope is history, not a
  // duplicate: renewing a cover grant must be possible.
  const duplicate = await prisma.roleAssignment.findFirst({
    where: {
      userId: body.userId,
      roleId: body.roleId,
      scopeType: body.scopeType,
      scopeId: body.scopeId,
      OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
    },
    select: { id: true },
  });
  if (duplicate) throw new OrgRuleError("This person already holds that role for that scope");
  return prisma.roleAssignment.create({
    data: { ...body, grantedById },
    select: ASSIGNMENT_SELECT,
  });
}

export async function removeAssignment(id: string) {
  const existing = await prisma.roleAssignment.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new OrgRuleError("That assignment does not exist", 404);
  await assertHrAccessAdminRemains({ removedAssignmentId: id });
  await prisma.roleAssignment.delete({ where: { id } });
}

// --- Effective access (UX P1 R12 "view access as…") ---------------------------

/**
 * What one person can do right now, and where: each permission with the scopes
 * it is held at (labelled), plus the active assignments that produce it. Read
 * from the same active-window rule `loadGrants` enforces, so the preview never
 * disagrees with the check. Platform-admin screens only.
 */
export async function effectiveAccess(userId: string) {
  const now = new Date();
  const rows = await prisma.roleAssignment.findMany({
    where: {
      userId,
      role: { deletedAt: null },
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
      ],
    },
    select: {
      id: true,
      scopeType: true,
      scopeId: true,
      validUntil: true,
      role: { select: { id: true, name: true, permissions: true } },
    },
    take: 200,
  });
  const labels = await scopeLabels(rows);
  const scopeOf = (r: (typeof rows)[number]) => ({
    type: r.scopeType,
    label: r.scopeId ? (labels.get(r.scopeId) ?? null) : null,
  });
  const byPermission = new Map<string, Array<{ type: string; label: string | null }>>();
  for (const r of rows) {
    for (const code of r.role.permissions) {
      const list = byPermission.get(code) ?? [];
      const scope = scopeOf(r);
      if (!list.some((s) => s.type === scope.type && s.label === scope.label)) list.push(scope);
      byPermission.set(code, list);
    }
  }
  return {
    assignments: rows.map((r) => ({
      id: r.id,
      role: { id: r.role.id, name: r.role.name },
      scope: scopeOf(r),
      validUntil: r.validUntil,
    })),
    permissions: [...byPermission.entries()]
      .map(([code, scopes]) => ({ code, scopes }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}
