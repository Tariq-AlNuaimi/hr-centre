import type { HiringApprovalRole } from "@/generated/prisma/client";
import type { Permission } from "@/lib/rbac/catalogue";
import { canInScope, has, hasGroup, type Grants, type ScopeSubject } from "@/lib/rbac/grants";

/**
 * Hiring authority — ADR-080 decision 1. Pure (no Prisma) so every route,
 * service and contract test asks the same questions.
 *
 * Interview Hub decided authority from an access role, a business role and a
 * user entity. Here all three are role-builder permissions held in a scope; a
 * hiring record's scope subject is its requisition's company / directorate /
 * department (lib/hiring/scope.ts builds it).
 */

export type HiringActor = {
  userId: string;
  name: string;
  grants: Grants;
};

/** Which permission makes someone eligible for an approval step. */
export const ROLE_PERMISSION: Record<HiringApprovalRole, Permission> = {
  HR_MANAGER: "hiring.hrManager",
  HR_SPECIALIST: "hiring.hrSpecialist",
  HIRING_MANAGER: "hiring.hiringManager",
  PANELIST: "hiring.panelist",
  DEPARTMENT_HEAD: "hiring.departmentHead",
  DIRECTOR: "hiring.director",
  OPERATIONS_MANAGER: "hiring.operationsManager",
  OPERATIONS_DIRECTOR: "hiring.operationsDirector",
  COO: "hiring.coo",
  CEO: "hiring.ceo",
};

/** Display order + labels key for the approval roles (Interview Hub APPROVER_ROLES). */
export const APPROVAL_ROLES = Object.keys(ROLE_PERMISSION) as HiringApprovalRole[];

/** Does the actor hold `permission` for this record? */
export function can(actor: HiringActor, permission: Permission, subject: ScopeSubject): boolean {
  return canInScope(actor.grants, permission, subject);
}

/** Held anywhere — for affordances only (nav, buttons); routes always ask `can`. */
export function holdsAnywhere(actor: HiringActor, permission: Permission): boolean {
  return has(actor.grants, permission);
}

/** Interview Hub's access ADMIN: module configuration, org-wide only. */
export function isHiringAdmin(actor: HiringActor): boolean {
  return hasGroup(actor.grants, "hiring.configure");
}

/** Holds approval role `role` for this record (Interview Hub `businessRole === role`). */
export function actsAs(actor: HiringActor, role: HiringApprovalRole, subject: ScopeSubject) {
  return can(actor, ROLE_PERMISSION[role], subject);
}

/** Skip a mandatory stage / the package gate: HR Manager or admin (stage-gates.ts). */
export function canOverrideGates(actor: HiringActor, subject: ScopeSubject): boolean {
  return isHiringAdmin(actor) || actsAs(actor, "HR_MANAGER", subject);
}

/** Edit the assessment policy, or its locked threshold: HR Manager or admin. */
export const canEditAssessmentPolicy = canOverrideGates;

/** The JD's HR signature slot: HR Manager, HR Specialist or admin. */
export function canSignJdForHr(actor: HiringActor, subject: ScopeSubject): boolean {
  return (
    isHiringAdmin(actor) ||
    actsAs(actor, "HR_MANAGER", subject) ||
    actsAs(actor, "HR_SPECIALIST", subject)
  );
}

/**
 * Restricted-PII projection switch: without `hiring.viewPii` a reader gets
 * Interview Hub's VIEWER projection of a candidate.
 */
export function seesPii(actor: HiringActor, subject: ScopeSubject): boolean {
  return can(actor, "hiring.viewPii", subject);
}

/**
 * Pay on a requisition or offer. `hiring.viewComp`, or the requisition's own
 * hiring manager when "hiring manager sees salary" is set (D10 — stored but
 * never enforced in Interview Hub), or someone routed to approve it.
 */
export function seesComp(
  actor: HiringActor,
  subject: ScopeSubject,
  opts: { hiringManagerId?: string | null; hmSeesSalary?: boolean; routedApprover?: boolean } = {},
): boolean {
  if (can(actor, "hiring.viewComp", subject)) return true;
  if (opts.routedApprover) return true;
  return Boolean(opts.hmSeesSalary && opts.hiringManagerId === actor.userId);
}

/**
 * Panel-only readers (Interview Hub businessRole PANELIST without edit rights)
 * see only candidates on interviews they are assigned to.
 */
export function isPanelOnly(actor: HiringActor, subject: ScopeSubject): boolean {
  return !can(actor, "hiring.manage", subject) && can(actor, "hiring.panelist", subject);
}
