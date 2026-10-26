import type { Session } from "next-auth";
import type { JmlCaseType, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveActor, type ResolvedActor } from "@/lib/pms/actor";
import { grantsOf } from "@/lib/pms/permissions";
import { canInScope, has, hasGroup, type ScopeSubject } from "@/lib/rbac/grants";
import type { Permission } from "@/lib/rbac/catalogue";
import { JmlError } from "./errors";

/**
 * JML authority (docs/blueprints/jml.md D12). Every check is a catalogue
 * permission evaluated against the case EMPLOYEE's placement (company,
 * directorate, department) through `lib/rbac` — HR Onboarding's seniority
 * (`actorSeniority`) and HR Offboarding's `isAdminRole` / `isHrManager` are
 * re-expressed as permissions held in scope.
 *
 * Out of scope answers 404 (no existence leak, foundation worst path); in scope
 * without the permission answers 403.
 */

export type JmlActor = ResolvedActor;

export async function jmlActor(session: Session): Promise<JmlActor> {
  return resolveActor(session);
}

/** Does the actor hold `permission` anywhere (for showing a screen at all)? */
export function holdsAnywhere(actor: JmlActor, permission: Permission): boolean {
  return has(grantsOf(actor), permission);
}

/** Org-wide only (configuration permissions; scoped grants of them count for nothing). */
export function holdsGroup(actor: JmlActor, permission: Permission): boolean {
  return hasGroup(grantsOf(actor), permission);
}

export function canFor(actor: JmlActor, permission: Permission, subject: ScopeSubject): boolean {
  return canInScope(grantsOf(actor), permission, subject);
}

/** Core permissions the JML screens also show affordances for. */
const CORE_AFFORDANCES = new Set(["people.viewSalary", "people.view"]);

/** The permissions the actor holds anywhere — the client's affordance list. */
export function heldJmlPermissions(actor: JmlActor): string[] {
  const grants = grantsOf(actor);
  return [...grants.keys()].filter(
    (p) => (p.startsWith("jml.") || CORE_AFFORDANCES.has(p)) && has(grants, p),
  );
}

/**
 * Prisma filter for the EMPLOYEES a permission covers: `{}` for Group scope,
 * an OR over company / directorate / department scopes, or null when the
 * permission is not held at all.
 */
export function employeeScopeWhere(
  actor: JmlActor,
  permission: Permission,
): Prisma.EmployeeWhereInput | null {
  const scopes = grantsOf(actor).get(permission) ?? [];
  if (scopes.length === 0) return null;
  if (scopes.some((s) => s.type === "GROUP")) return {};
  const ids = (type: string) => scopes.filter((s) => s.type === type && s.id).map((s) => s.id!);
  const or: Prisma.EmployeeWhereInput[] = [];
  const companies = ids("COMPANY");
  const directorates = ids("DIRECTORATE");
  const departments = ids("DEPARTMENT");
  if (companies.length) or.push({ entityId: { in: companies } });
  if (departments.length) or.push({ departmentId: { in: departments } });
  if (directorates.length) or.push({ department: { directorateId: { in: directorates } } });
  return or.length ? { OR: or } : null;
}

/** Prisma filter for the CASES a permission covers (via the case's employee). */
export function caseScopeWhere(
  actor: JmlActor,
  permission: Permission,
): Prisma.JmlCaseWhereInput | null {
  const employee = employeeScopeWhere(actor, permission);
  if (employee === null) return null;
  return Object.keys(employee).length === 0 ? {} : { employee };
}

const CASE_ACCESS_SELECT = {
  id: true,
  caseRef: true,
  caseType: true,
  status: true,
  stage: true,
  employeeId: true,
  hrOwnerUserId: true,
  version: true,
  employee: {
    select: {
      entityId: true,
      departmentId: true,
      department: { select: { directorateId: true } },
    },
  },
} as const;

export type AccessibleCase = Prisma.JmlCaseGetPayload<{ select: typeof CASE_ACCESS_SELECT }> & {
  subject: ScopeSubject;
};

export function subjectOf(employee: {
  entityId: string;
  departmentId: string | null;
  department: { directorateId: string | null } | null;
}): ScopeSubject {
  return {
    entityId: employee.entityId,
    departmentId: employee.departmentId,
    directorateId: employee.department?.directorateId ?? null,
  };
}

/**
 * Load a case for an action: 404 if it does not exist, is of another type, or
 * the actor cannot even SEE it; 403 if they can see it but lack `permission`.
 */
export async function loadCaseFor(
  actor: JmlActor,
  caseId: string,
  permission: Permission,
  expectType?: JmlCaseType,
): Promise<AccessibleCase> {
  const row = await prisma.jmlCase.findUnique({
    where: { id: caseId },
    select: CASE_ACCESS_SELECT,
  });
  if (!row || (expectType && row.caseType !== expectType)) {
    throw new JmlError("Case not found", 404);
  }
  const subject = subjectOf(row.employee);
  if (!canFor(actor, "jml.view", subject)) throw new JmlError("Case not found", 404);
  if (!canFor(actor, permission, subject)) {
    throw new JmlError("You do not have permission to do that on this case.", 403);
  }
  return { ...row, subject };
}

/** Which "manage" permission a case type needs. */
export const MANAGE_PERMISSION: Record<JmlCaseType, Permission> = {
  JOIN: "jml.manageJoiners",
  MOVE: "jml.manageMovers",
  LEAVE: "jml.manageLeavers",
};
