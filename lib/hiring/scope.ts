import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { Permission } from "@/lib/rbac/catalogue";
import { hasGroup, partialScopes, type ScopeSubject } from "@/lib/rbac/grants";
import type { HiringActor } from "./access";

/**
 * Where a hiring record sits, for `scopeCovers`. Every hiring record's scope is
 * its requisition's: company, department and (looked up) directorate — so a
 * grant scoped to a directorate covers its departments' requisitions.
 */
export async function requisitionSubject(req: {
  entityId: string;
  departmentId: string | null;
}): Promise<ScopeSubject> {
  if (!req.departmentId) return { entityId: req.entityId, departmentId: null, directorateId: null };
  const dept = await prisma.department.findUnique({
    where: { id: req.departmentId },
    select: { directorateId: true },
  });
  return {
    entityId: req.entityId,
    departmentId: req.departmentId,
    directorateId: dept?.directorateId ?? null,
  };
}

/**
 * The requisitions an actor may touch with `permission`, as a Prisma filter.
 * `null` = none at all (the caller answers 404 / an empty list); `{}` = every
 * requisition (Group scope). A directorate scope expands to its departments.
 */
export async function requisitionScopeWhere(
  actor: HiringActor,
  permission: Permission,
): Promise<Prisma.HiringRequisitionWhereInput | null> {
  if (hasGroup(actor.grants, permission)) return {};
  const scopes = partialScopes(actor.grants, permission);
  if (scopes.length === 0) return null;
  const ids = (type: string) => scopes.filter((s) => s.type === type && s.id).map((s) => s.id!);
  const companies = ids("COMPANY");
  const departments = ids("DEPARTMENT");
  const directorates = ids("DIRECTORATE");
  if (directorates.length) {
    const rows = await prisma.department.findMany({
      where: { directorateId: { in: directorates } },
      select: { id: true },
      take: 2000,
    });
    departments.push(...rows.map((r) => r.id));
  }
  const or: Prisma.HiringRequisitionWhereInput[] = [];
  if (companies.length) or.push({ entityId: { in: companies } });
  if (departments.length) or.push({ departmentId: { in: departments } });
  return or.length ? { OR: or } : null;
}

/** Candidates in scope. Detached candidates (no requisition) need a Group grant. */
export async function candidateScopeWhere(
  actor: HiringActor,
  permission: Permission,
): Promise<Prisma.HiringCandidateWhereInput | null> {
  const req = await requisitionScopeWhere(actor, permission);
  if (req === null) return null;
  if (Object.keys(req).length === 0) return {};
  return { requisition: req };
}

/** Companies the actor may act in with `permission` (null = all). For pickers. */
export function companyScope(actor: HiringActor, permission: Permission): string[] | null {
  if (hasGroup(actor.grants, permission)) return null;
  return partialScopes(actor.grants, permission)
    .filter((s) => s.type === "COMPANY" && s.id)
    .map((s) => s.id!);
}

/** Scope subjects for many requisitions in ONE department query (lists — no N+1). */
export async function requisitionSubjects(
  reqs: ReadonlyArray<{ id: string; entityId: string; departmentId: string | null }>,
): Promise<Map<string, ScopeSubject>> {
  const deptIds = [...new Set(reqs.flatMap((r) => (r.departmentId ? [r.departmentId] : [])))];
  const depts = deptIds.length
    ? await prisma.department.findMany({
        where: { id: { in: deptIds } },
        select: { id: true, directorateId: true },
        take: deptIds.length,
      })
    : [];
  const dir = new Map(depts.map((d) => [d.id, d.directorateId]));
  return new Map(
    reqs.map((r) => [
      r.id,
      {
        entityId: r.entityId,
        departmentId: r.departmentId,
        directorateId: r.departmentId ? (dir.get(r.departmentId) ?? null) : null,
      },
    ]),
  );
}
