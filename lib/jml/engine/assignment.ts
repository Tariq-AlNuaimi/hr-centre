import type { JmlCaseType, JmlRuleScope, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { ScopeSubject } from "@/lib/rbac/grants";
import { paginatedResponse, type PaginationParams } from "@/lib/pagination";
import {
  CASE_SEAT_SELECT,
  resolveCaseOwner,
  seatProblem,
  unitSubject,
  userHolds,
  type CaseSeatRow,
} from "@/lib/core/hr-coverage/store";
import { unitIdOf, type Placement } from "@/lib/core/hr-coverage/rules";
import { JmlError } from "../errors";

/**
 * HR owner assignment — ONE rule model for every case type (D6): HR
 * Onboarding's scoped-with-priority form (§14, BR-002), the superset of HR
 * Offboarding's department-only pairing (BR-OFF-002). A rule may be limited to
 * case types (empty = all).
 *
 * ADR-102: the rules are rows of the core HR coverage model
 * (`lib/core/hr-coverage`) — the same rows HR tickets route by — that name a
 * case owner and supervisor. This file keeps JML's shape of them (scope,
 * scopeId, juniorHr, seniorHr) for the JML API; resolution is the core's:
 * most specific rung wins (DEPARTMENT, then DIRECTORATE, then COMPANY), then
 * priority DESC, then oldest; both seats must be live accounts. No rule ⇒ null
 * ⇒ the caller refuses (no default owner invented).
 */

export type RuleRow = {
  id: string;
  scope: JmlRuleScope;
  scopeId: string;
  priority: number;
  active: boolean;
  caseTypes: JmlCaseType[];
  createdAt: Date;
  juniorHr: { id: string; name: string | null; email: string };
  seniorHr: { id: string; name: string | null; email: string };
};

export type { Placement };

/** A coverage row with case seats, in JML's rule shape. */
function toRule(row: CaseSeatRow): RuleRow {
  return {
    id: row.id,
    scope: row.level as JmlRuleScope,
    scopeId: unitIdOf(row) ?? "",
    priority: row.priority,
    active: row.active,
    caseTypes: row.caseTypes,
    createdAt: row.createdAt,
    juniorHr: row.owner!,
    seniorHr: row.supervisor!,
  };
}

/** Rows that are JML rules: a company / directorate / department with both seats named. */
const JML_RULES = {
  level: { in: ["COMPANY", "DIRECTORATE", "DEPARTMENT"] },
  ownerUserId: { not: null },
  supervisorUserId: { not: null },
} as const satisfies Prisma.HrCoverageWhereInput;

type RuleClient = Pick<typeof prisma, "hrCoverage">;

export async function resolveHrAssignment(
  placement: Placement,
  caseType: JmlCaseType,
  client: RuleClient = prisma,
): Promise<{ rule: RuleRow; matchedScope: JmlRuleScope; candidateCount: number } | null> {
  const hit = await resolveCaseOwner(placement, caseType, client);
  return hit
    ? { rule: toRule(hit.row), matchedScope: hit.matchedLevel, candidateCount: hit.candidateCount }
    : null;
}

async function subjectForTarget(scope: JmlRuleScope, id: string): Promise<ScopeSubject> {
  const subject = await unitSubject(scope, id);
  if (!subject) throw new JmlError("The selected organisation unit was not found", 404);
  return subject;
}

async function assertPair(juniorId: string, seniorId: string, subject: ScopeSubject) {
  const problem = await seatProblem(juniorId, seniorId, subject);
  if (problem) throw new JmlError(problem, 400);
}

/** The unit columns of a rule's target (a department rule names only its department). */
function unitColumns(scope: JmlRuleScope, id: string, subject: ScopeSubject) {
  return {
    level: scope,
    entityId: subject.entityId,
    directorateId: scope === "DIRECTORATE" ? id : null,
    departmentId: scope === "DEPARTMENT" ? id : null,
    teamId: null,
    companyWide: false,
  };
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
  const row = await prisma.hrCoverage.create({
    data: {
      ...unitColumns(input.scope, input.scopeId, subject),
      priority: input.priority,
      active: input.active,
      caseTypes: input.caseTypes,
      ownerUserId: input.juniorHrUserId,
      supervisorUserId: input.seniorHrUserId,
    },
    select: CASE_SEAT_SELECT,
  });
  return toRule(row);
}

export async function updateAssignmentRule(
  id: string,
  input: Partial<RuleInput>,
): Promise<RuleRow> {
  const found = await prisma.hrCoverage.findFirst({
    where: { id, ...JML_RULES },
    select: CASE_SEAT_SELECT,
  });
  if (!found) throw new JmlError("Assignment rule not found", 404);
  const existing = toRule(found);
  const scope = input.scope ?? existing.scope;
  const scopeId = input.scopeId ?? existing.scopeId;
  const junior = input.juniorHrUserId ?? existing.juniorHr.id;
  const senior = input.seniorHrUserId ?? existing.seniorHr.id;
  let unit = {};
  if (input.scope || input.scopeId || input.juniorHrUserId || input.seniorHrUserId) {
    const subject = await subjectForTarget(scope, scopeId);
    await assertPair(junior, senior, subject);
    if (input.scope || input.scopeId) unit = unitColumns(scope, scopeId, subject);
  }
  const row = await prisma.hrCoverage.update({
    where: { id },
    data: {
      ...unit,
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.active === undefined ? {} : { active: input.active }),
      ...(input.caseTypes === undefined ? {} : { caseTypes: input.caseTypes }),
      ownerUserId: junior,
      supervisorUserId: senior,
    },
    select: CASE_SEAT_SELECT,
  });
  return toRule(row);
}

export async function listAssignmentRules(
  filter: { scope?: JmlRuleScope; active?: boolean; hrUserId?: string; entityId?: string },
  page: PaginationParams,
) {
  const and: Prisma.HrCoverageWhereInput[] = [JML_RULES];
  if (filter.hrUserId) {
    and.push({ OR: [{ ownerUserId: filter.hrUserId }, { supervisorUserId: filter.hrUserId }] });
  }
  // A company filter covers all three rungs under it: every row carries its company.
  if (filter.entityId) and.push({ entityId: filter.entityId });
  const where: Prisma.HrCoverageWhereInput = {
    ...(filter.scope ? { level: filter.scope } : {}),
    ...(filter.active === undefined ? {} : { active: filter.active }),
    AND: and,
  };
  const [rows, total] = await Promise.all([
    prisma.hrCoverage.findMany({
      where,
      orderBy: [{ level: "desc" }, { priority: "desc" }, { createdAt: "asc" }],
      skip: page.skip,
      take: page.take,
      select: CASE_SEAT_SELECT,
    }),
    prisma.hrCoverage.count({ where }),
  ]);
  return paginatedResponse(rows.map(toRule), total, page);
}

export { userHolds };

/** Logins that may hold a case (the owner pickers) — the core's list (ADR-102). */
export { caseSeatHolders as listJmlHrUsers } from "@/lib/core/hr-coverage/store";
