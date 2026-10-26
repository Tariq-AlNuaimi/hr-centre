import { prisma } from "@/lib/prisma";
import type { Permission } from "@/lib/rbac/catalogue";
import type { ScopeSubject } from "@/lib/rbac/grants";
import { usersHoldingPermission } from "@/lib/rbac/resolve";

/**
 * People references (ADR-080 decision 3): hiring rows hold core `User` ids;
 * names are resolved here in ONE batched query per response, never per row.
 */

export type PersonRef = { id: string; name: string; email: string };

export async function peopleById(
  ids: Iterable<string | null | undefined>,
): Promise<Map<string, PersonRef>> {
  const unique = [...new Set([...ids].filter((v): v is string => Boolean(v)))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, email: true },
    take: unique.length,
  });
  return new Map(rows.map((u) => [u.id, { id: u.id, name: u.name ?? u.email, email: u.email }]));
}

export function personOrNull(map: Map<string, PersonRef>, id: string | null | undefined) {
  return id ? (map.get(id) ?? null) : null;
}

/** A live user (for validating a hiring manager / owner / panelist id on write). */
export async function isLiveUser(id: string): Promise<boolean> {
  const u = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  return Boolean(u);
}

/**
 * The picker list: live users matching `search`, optionally narrowed to those
 * holding `permission` for `subject` (approver / recipient / panel pickers).
 */
export async function directory(opts: {
  search?: string;
  permission?: Permission;
  subject?: ScopeSubject;
  limit?: number;
}): Promise<PersonRef[]> {
  const limit = Math.min(opts.limit ?? 25, 50);
  const holderIds =
    opts.permission && opts.subject
      ? await usersHoldingPermission(opts.permission, opts.subject, { limit: 500 })
      : null;
  const q = opts.search?.trim();
  const rows = await prisma.user.findMany({
    where: {
      deletedAt: null,
      ...(holderIds ? { id: { in: holderIds } } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { email: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
    take: limit,
  });
  return rows.map((u) => ({ id: u.id, name: u.name ?? u.email, email: u.email }));
}

/** Company + department names for display. */
export async function orgNames(entityIds: string[], departmentIds: string[]) {
  const [entities, departments] = await Promise.all([
    entityIds.length
      ? prisma.orgEntity.findMany({
          where: { id: { in: [...new Set(entityIds)] } },
          select: { id: true, code: true, name: true },
          take: 50,
        })
      : [],
    departmentIds.length
      ? prisma.department.findMany({
          where: { id: { in: [...new Set(departmentIds)] } },
          select: { id: true, name: true },
          take: 1000,
        })
      : [],
  ]);
  return {
    entities: new Map(entities.map((e) => [e.id, e])),
    departments: new Map(departments.map((d) => [d.id, d.name])),
  };
}
