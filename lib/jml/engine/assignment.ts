import type { JmlCaseType, JmlRuleScope, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { loadGrants } from "@/lib/rbac/resolve";
import { canInScope, type ScopeSubject } from "@/lib/rbac/grants";
import type { Permission } from "@/lib/rbac/catalogue";
import { paginatedResponse, type PaginationParams } from "@/lib/pagination";
import { JmlError } from "../errors";

/**
 * HR owner assignment — ONE rule model for every case type (D6): HR
 * Onboarding's scoped-with-priority form (§14, BR-002), which is the superset of
 * HR Offboarding's department-only pairing (BR-OFF-002). A rule may be limited
 * to case types (empty = all).
 *
 * Resolution: one `take: 1` query per rung the placement has, most specific
 * rung wins — DEPARTMENT, then DIRECTORATE, then COMPANY (prototype ladder,
 * open question 1) — then priority DESC, then oldest. Both seats must be live
 * accounts. No rule ⇒ null ⇒ the caller refuses (no default owner invented).
 *
 * Seats are permissions, not HR roles: the owner must hold `jml.workTasks`
 * and the paired senior `jml.supervise`, each for the rule's target.
 */

export const SCOPE_PRECEDENCE: readonly JmlRuleScope[] = ["DEPARTMENT", "DIRECTORATE", "COMPANY"];

const RULE_ORDER: Prisma.JmlHrAssignmentRuleOrderByWithRelationInput[] = [
  { priority: "desc" },
  { createdAt: "asc" },
];

const LIVE_PAIR = { juniorHr: { deletedAt: null }, seniorHr: { deletedAt: null } } as const;

export const RULE_SELECT = {
  id: true,
  scope: true,
  scopeId: true,
  priority: true,
  active: true,
  caseTypes: true,
  createdAt: true,
  juniorHr: { select: { id: true, name: true, email: true } },
  seniorHr: { select: { id: true, name: true, email: true } },
} as const;

export type RuleRow = Prisma.JmlHrAssignmentRuleGetPayload<{ select: typeof RULE_SELECT }>;

export type Placement = {
  entityId: string;
  directorateId: string | null;
  departmentId: string | null;
};

type RuleClient = Pick<typeof prisma, "jmlHrAssignmentRule">;

function rungs(p: Placement): Array<{ scope: JmlRuleScope; scopeId: string }> {
  return [
    ...(p.departmentId ? [{ scope: "DEPARTMENT" as const, scopeId: p.departmentId }] : []),
    ...(p.directorateId ? [{ scope: "DIRECTORATE" as const, scopeId: p.directorateId }] : []),
    { scope: "COMPANY" as const, scopeId: p.entityId },
  ];
}

export async function resolveHrAssignment(
  placement: Placement,
  caseType: JmlCaseType,
  client: RuleClient = prisma,
): Promise<{ rule: RuleRow; matchedScope: JmlRuleScope; candidateCount: number } | null> {
  const typeFilter = { OR: [{ caseTypes: { isEmpty: true } }, { caseTypes: { has: caseType } }] };
  const matches = rungs(placement);
  const [byRung, candidateCount] = await Promise.all([
    Promise.all(
      matches.map((m) =>
        client.jmlHrAssignmentRule.findMany({
          where: { active: true, ...LIVE_PAIR, ...m, AND: [typeFilter] },
          orderBy: RULE_ORDER,
          take: 1,
          select: RULE_SELECT,
        }),
      ),
    ),
    client.jmlHrAssignmentRule.count({
      where: { active: true, ...LIVE_PAIR, OR: matches, AND: [typeFilter] },
    }),
  ]);
  const winners = byRung.flat();
  for (const scope of SCOPE_PRECEDENCE) {
    const rule = winners.find((r) => r.scope === scope);
    if (rule) return { rule, matchedScope: scope, candidateCount };
  }
  return null;
}

/** The scope subject an org unit stands for (for seat checks). */
export async function subjectForTarget(scope: JmlRuleScope, id: string): Promise<ScopeSubject> {
  if (scope === "COMPANY") {
    const c = await prisma.orgEntity.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw new JmlError("The selected organisation unit was not found", 404);
    return { entityId: id, directorateId: null, departmentId: null };
  }
  if (scope === "DIRECTORATE") {
    const d = await prisma.directorate.findUnique({ where: { id }, select: { entityId: true } });
    if (!d) throw new JmlError("The selected organisation unit was not found", 404);
    return { entityId: d.entityId, directorateId: id, departmentId: null };
  }
  const d = await prisma.department.findUnique({
    where: { id },
    select: { entityId: true, directorateId: true },
  });
  if (!d) throw new JmlError("The selected organisation unit was not found", 404);
  return { entityId: d.entityId, directorateId: d.directorateId, departmentId: id };
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

async function assertPair(juniorId: string, seniorId: string, subject: ScopeSubject) {
  if (juniorId === seniorId) throw new JmlError("A pair needs two different people", 400);
  const [junior, senior] = await Promise.all([
    userHolds(juniorId, "jml.workTasks", subject),
    userHolds(seniorId, "jml.supervise", subject),
  ]);
  if (!junior) {
    throw new JmlError(
      "The case owner must hold the “Work checklist tasks” permission for this unit (e.g. the Junior HR role)",
      400,
    );
  }
  if (!senior) {
    throw new JmlError(
      "The paired supervisor must hold the “Supervise cases” permission for this unit (e.g. Senior HR or HR Manager)",
      400,
    );
  }
}

export type RuleInput = {
  scope: JmlRuleScope;
  scopeId: string;
  priority: number;
  active: boolean;
  caseTypes: JmlCaseType[];
  juniorHrUserId: string;
  seniorHrUserId: string;
};

export async function createAssignmentRule(input: RuleInput): Promise<RuleRow> {
  const subject = await subjectForTarget(input.scope, input.scopeId);
  await assertPair(input.juniorHrUserId, input.seniorHrUserId, subject);
  return prisma.jmlHrAssignmentRule.create({ data: input, select: RULE_SELECT });
}

export async function updateAssignmentRule(
  id: string,
  input: Partial<RuleInput>,
): Promise<RuleRow> {
  const existing = await prisma.jmlHrAssignmentRule.findUnique({
    where: { id },
    select: RULE_SELECT,
  });
  if (!existing) throw new JmlError("Assignment rule not found", 404);
  const scope = input.scope ?? existing.scope;
  const scopeId = input.scopeId ?? existing.scopeId;
  const junior = input.juniorHrUserId ?? existing.juniorHr.id;
  const senior = input.seniorHrUserId ?? existing.seniorHr.id;
  if (input.scope || input.scopeId || input.juniorHrUserId || input.seniorHrUserId) {
    await assertPair(junior, senior, await subjectForTarget(scope, scopeId));
  }
  return prisma.jmlHrAssignmentRule.update({
    where: { id },
    data: { ...input, scope, scopeId, juniorHrUserId: junior, seniorHrUserId: senior },
    select: RULE_SELECT,
  });
}

export async function listAssignmentRules(
  filter: { scope?: JmlRuleScope; active?: boolean; hrUserId?: string; entityId?: string },
  page: PaginationParams,
) {
  const and: Prisma.JmlHrAssignmentRuleWhereInput[] = [];
  if (filter.hrUserId) {
    and.push({ OR: [{ juniorHrUserId: filter.hrUserId }, { seniorHrUserId: filter.hrUserId }] });
  }
  if (filter.entityId) {
    // A company filter covers all three rungs under it.
    const [directorates, departments] = await Promise.all([
      prisma.directorate.findMany({
        where: { entityId: filter.entityId },
        select: { id: true },
        take: 500,
      }),
      prisma.department.findMany({
        where: { entityId: filter.entityId },
        select: { id: true },
        take: 2000,
      }),
    ]);
    and.push({
      scopeId: {
        in: [filter.entityId, ...directorates.map((d) => d.id), ...departments.map((d) => d.id)],
      },
    });
  }
  const where: Prisma.JmlHrAssignmentRuleWhereInput = {
    ...(filter.scope ? { scope: filter.scope } : {}),
    ...(filter.active === undefined ? {} : { active: filter.active }),
    ...(and.length ? { AND: and } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.jmlHrAssignmentRule.findMany({
      where,
      orderBy: [{ scope: "desc" }, ...RULE_ORDER],
      skip: page.skip,
      take: page.take,
      select: RULE_SELECT,
    }),
    prisma.jmlHrAssignmentRule.count({ where }),
  ]);
  return paginatedResponse(rows, total, page);
}

/**
 * Logins that may hold a case (anyone with `jml.workTasks` somewhere) — the
 * owner pickers. Bounded; soft-deleted accounts excluded.
 */
export async function listJmlHrUsers(): Promise<
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
