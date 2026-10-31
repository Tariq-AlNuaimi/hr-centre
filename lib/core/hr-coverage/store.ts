import type { HrCoverageLevel, JmlCaseType, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { loadGrants } from "@/lib/rbac/resolve";
import { canInScope, type ScopeSubject } from "@/lib/rbac/grants";
import type { Permission } from "@/lib/rbac/catalogue";
import { CASE_LEVEL_PRECEDENCE, caseRungs, type CaseLevel, type Placement } from "./rules";

/**
 * Core HR coverage storage (ADR-102): the one table both HR tickets and JML
 * read for "who is my HR". This file owns the case-owner resolution JML relies
 * on and the seat checks; ticket routing reads the same rows through
 * lib/hive/hrtag-source.ts; the admin screen writes through ./admin.ts.
 */

export const CASE_SEAT_SELECT = {
  id: true,
  level: true,
  entityId: true,
  directorateId: true,
  departmentId: true,
  teamId: true,
  priority: true,
  active: true,
  caseTypes: true,
  createdAt: true,
  owner: { select: { id: true, name: true, email: true } },
  supervisor: { select: { id: true, name: true, email: true } },
} as const satisfies Prisma.HrCoverageSelect;

export type CaseSeatRow = Prisma.HrCoverageGetPayload<{ select: typeof CASE_SEAT_SELECT }>;

/** Live case seats: both people named and neither account deleted. */
const LIVE_SEATS = {
  owner: { is: { deletedAt: null } },
  supervisor: { is: { deletedAt: null } },
} as const satisfies Prisma.HrCoverageWhereInput;

const CASE_ORDER: Prisma.HrCoverageOrderByWithRelationInput[] = [
  { priority: "desc" },
  { createdAt: "asc" },
];

type CoverageClient = Pick<typeof prisma, "hrCoverage">;

/**
 * Who owns (and supervises) a case for this placement: one `take: 1` query per
 * rung the placement has; the most specific rung wins, then priority, then the
 * oldest row. Only active rows with live seats count, limited to the case type
 * (empty = every type). Null = no coverage (the caller refuses; no default
 * owner is invented).
 */
export async function resolveCaseOwner(
  placement: Placement,
  caseType: JmlCaseType,
  client: CoverageClient = prisma,
): Promise<{ row: CaseSeatRow; matchedLevel: CaseLevel; candidateCount: number } | null> {
  const typeFilter = { OR: [{ caseTypes: { isEmpty: true } }, { caseTypes: { has: caseType } }] };
  const rungs = caseRungs(placement);
  const live = { active: true, deletedAt: null, ...LIVE_SEATS };
  const [byRung, candidateCount] = await Promise.all([
    Promise.all(
      rungs.map((r) =>
        client.hrCoverage.findMany({
          where: { ...live, ...(r.where as Prisma.HrCoverageWhereInput), AND: [typeFilter] },
          orderBy: CASE_ORDER,
          take: 1,
          select: CASE_SEAT_SELECT,
        }),
      ),
    ),
    client.hrCoverage.count({
      where: {
        ...live,
        OR: rungs.map((r) => r.where as Prisma.HrCoverageWhereInput),
        AND: [typeFilter],
      },
    }),
  ]);
  const winners = byRung.flat();
  for (const level of CASE_LEVEL_PRECEDENCE) {
    const row = winners.find((r) => r.level === level);
    if (row) return { row, matchedLevel: level, candidateCount };
  }
  return null;
}

/** The scope subject an org unit stands for, or null when it does not exist. */
export async function unitSubject(
  level: HrCoverageLevel,
  id: string,
): Promise<ScopeSubject | null> {
  if (level === "COMPANY") {
    const c = await prisma.orgEntity.findUnique({ where: { id }, select: { id: true } });
    return c ? { entityId: id, directorateId: null, departmentId: null } : null;
  }
  if (level === "DIRECTORATE") {
    const d = await prisma.directorate.findUnique({ where: { id }, select: { entityId: true } });
    return d ? { entityId: d.entityId, directorateId: id, departmentId: null } : null;
  }
  if (level === "DEPARTMENT") {
    const d = await prisma.department.findUnique({
      where: { id },
      select: { entityId: true, directorateId: true },
    });
    return d ? { entityId: d.entityId, directorateId: d.directorateId, departmentId: id } : null;
  }
  const t = await prisma.team.findUnique({
    where: { id },
    select: { departmentId: true, department: { select: { entityId: true, directorateId: true } } },
  });
  return t
    ? {
        entityId: t.department.entityId,
        directorateId: t.department.directorateId,
        departmentId: t.departmentId,
      }
    : null;
}

/** Does this login hold `permission` for `subject` right now? */
export async function userHolds(
  userId: string,
  permission: Permission,
  subject: ScopeSubject,
): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return false;
  return canInScope(await loadGrants(userId), permission, subject);
}

/**
 * Why these two people cannot hold a unit's case seats, or null. Seats are
 * permissions, not HR roles: the owner must hold `jml.workTasks` and the
 * supervisor `jml.supervise`, each for the unit.
 */
export async function seatProblem(
  ownerId: string,
  supervisorId: string,
  subject: ScopeSubject,
): Promise<string | null> {
  if (ownerId === supervisorId) return "A pair needs two different people";
  const [owner, supervisor] = await Promise.all([
    userHolds(ownerId, "jml.workTasks", subject),
    userHolds(supervisorId, "jml.supervise", subject),
  ]);
  if (!owner)
    return "The case owner must hold the “Work checklist tasks” permission for this unit (e.g. the Junior HR role)";
  if (!supervisor)
    return "The paired supervisor must hold the “Supervise cases” permission for this unit (e.g. Senior HR or HR Manager)";
  return null;
}

/** Logins that may hold a case seat (anyone with `jml.workTasks` or `jml.supervise`). */
export async function caseSeatHolders(): Promise<
  Array<{ id: string; name: string | null; email: string; supervises: boolean }>
> {
  const rows = await prisma.roleAssignment.findMany({
    where: {
      role: { deletedAt: null, permissions: { hasSome: ["jml.workTasks", "jml.supervise"] } },
      user: { deletedAt: null },
    },
    select: {
      user: { select: { id: true, name: true, email: true } },
      role: { select: { permissions: true } },
    },
    take: 1000,
  });
  const out = new Map<
    string,
    { id: string; name: string | null; email: string; supervises: boolean }
  >();
  for (const r of rows) {
    const prev = out.get(r.user.id);
    const supervises = r.role.permissions.includes("jml.supervise");
    out.set(r.user.id, { ...r.user, supervises: supervises || (prev?.supervises ?? false) });
  }
  return [...out.values()].sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}
