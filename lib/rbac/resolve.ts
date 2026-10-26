import { prisma } from "@/lib/prisma";
import { SCOPED_PERMISSIONS, type Permission } from "./catalogue";
import {
  expandGrants,
  isAssignmentActive,
  partialScopes,
  scopeCovers,
  type Grants,
  type ScopeSubject,
} from "./grants";

/**
 * The database half of RBAC (F-c): one query per request for the actor's
 * assignments (blueprint Speed pillar), expanded in memory by lib/rbac/grants.ts.
 */

/** Assignments in force right now. Expired / not-yet-started cover grants nothing. */
function activeWindow(now: Date) {
  return {
    AND: [
      { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
      { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
    ],
  };
}

export async function loadGrants(userId: string, now: Date = new Date()): Promise<Grants> {
  const rows = await prisma.roleAssignment.findMany({
    where: { userId, role: { deletedAt: null }, ...activeWindow(now) },
    select: {
      scopeType: true,
      scopeId: true,
      validFrom: true,
      validUntil: true,
      role: { select: { permissions: true } },
    },
    // Bounded: a person holds a handful of assignments, not hundreds.
    take: 200,
  });
  return expandGrants(
    rows
      .filter((r) => isAssignmentActive(r, now))
      .map((r) => ({
        permissions: r.role.permissions,
        scope: { type: r.scopeType, id: r.scopeId },
      })),
  );
}

/** Role names the user holds now — display only (My tasks, the directory). */
export async function roleNamesFor(userId: string, now: Date = new Date()): Promise<string[]> {
  const rows = await prisma.roleAssignment.findMany({
    where: { userId, role: { deletedAt: null }, ...activeWindow(now) },
    select: { role: { select: { name: true } } },
    take: 200,
  });
  return [...new Set(rows.map((r) => r.role.name))].sort();
}

/** Upper bound on a scoped viewer's member set (a company is hundreds of people). */
const MAX_SCOPE_MEMBERS = 10_000;

/**
 * The employees a NON-Group `permission` grant covers — e.g. an HRBP scoped to
 * Codeline sees Codeline's people (AC-F3.2). Empty when the permission is held
 * at Group scope (the caller treats that as org-wide) or not at all. Org scope
 * kinds only; module kinds have no employee mapping.
 */
export async function scopeMemberIds(grants: Grants, permission: Permission): Promise<Set<string>> {
  const scopes = partialScopes(grants, permission);
  const ids = (type: string) => scopes.filter((s) => s.type === type && s.id).map((s) => s.id!);
  const [companies, directorates, departments] = [
    ids("COMPANY"),
    ids("DIRECTORATE"),
    ids("DEPARTMENT"),
  ];
  if (companies.length + directorates.length + departments.length === 0) return new Set();
  const rows = await prisma.employee.findMany({
    where: {
      OR: [
        ...(companies.length ? [{ entityId: { in: companies } }] : []),
        ...(departments.length ? [{ departmentId: { in: departments } }] : []),
        ...(directorates.length ? [{ department: { directorateId: { in: directorates } } }] : []),
      ],
    },
    select: { id: true },
    take: MAX_SCOPE_MEMBERS,
  });
  return new Set(rows.map((r) => r.id));
}

/** An employee's placement as a scope subject, or null if there is no such employee. */
export async function placementOf(employeeId: string): Promise<ScopeSubject | null> {
  const e = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { entityId: true, departmentId: true, department: { select: { directorateId: true } } },
  });
  if (!e) return null;
  return {
    entityId: e.entityId,
    departmentId: e.departmentId,
    directorateId: e.department?.directorateId ?? null,
  };
}

/**
 * Which users hold `permission` for `subject` right now — e.g. "who is HR for
 * this Codeline employee" when picking notification recipients. Bounded: at most
 * `limit` users (default 200), soft-deleted users excluded.
 */
export async function usersHoldingPermission(
  permission: Permission,
  subject: ScopeSubject,
  { limit = 200, now = new Date() }: { limit?: number; now?: Date } = {},
): Promise<string[]> {
  const rows = await prisma.roleAssignment.findMany({
    where: {
      role: { deletedAt: null, permissions: { has: permission } },
      user: { deletedAt: null },
      ...activeWindow(now),
    },
    select: { userId: true, scopeType: true, scopeId: true, validFrom: true, validUntil: true },
    take: 2000,
  });
  const out = new Set<string>();
  for (const r of rows) {
    if (out.size >= limit) break;
    if (!isAssignmentActive(r, now)) continue;
    // Same rule as canInScope: an org-wide permission only counts at Group scope.
    if (!SCOPED_PERMISSIONS.has(permission) && r.scopeType !== "GROUP") continue;
    if (scopeCovers({ type: r.scopeType, id: r.scopeId }, subject)) out.add(r.userId);
  }
  return [...out];
}

/** The scope subject for a placement that may not exist yet (a new or moved employee). */
export async function subjectForPlacement(
  entityId: string,
  departmentId: string | null,
): Promise<ScopeSubject> {
  if (!departmentId) return { entityId, departmentId: null, directorateId: null };
  const department = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { directorateId: true },
  });
  return { entityId, departmentId, directorateId: department?.directorateId ?? null };
}
