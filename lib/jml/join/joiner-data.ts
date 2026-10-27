import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSalary } from "@/lib/pms/employee-select";
import { isPlaceholderEmail, isProvisionalOdooId } from "@/lib/people/provisional-id";
import { teamPlacementProblem } from "@/lib/org/teams";
import type { ScopeSubject } from "@/lib/rbac/grants";
import { canFor, type JmlActor } from "../access";
import { JmlError } from "../errors";

/**
 * A joiner = a JOIN case + its PRE_JOINER (later ACTIVE) employee + its join
 * detail. One select, one serializer, so every joiner screen reads the same
 * shape and the salary is decrypted only for an actor holding
 * `people.viewSalary` for that person (ADR-067; Onboarding §15 "view salary in
 * accessible cases").
 */

const JOINER_SELECT = {
  id: true,
  caseRef: true,
  status: true,
  stage: true,
  version: true,
  completionPct: true,
  activatedAt: true,
  completedAt: true,
  cancelledAt: true,
  cancelReason: true,
  duplicateOverrideReason: true,
  legalHold: true,
  legalHoldReason: true,
  archivedAt: true,
  anonymisedAt: true,
  createdAt: true,
  hrOwner: { select: { id: true, name: true, email: true } },
  seniorHr: { select: { id: true, name: true, email: true } },
  template: { select: { id: true, name: true, version: true } },
  joinDetail: {
    select: {
      contractTypeId: true,
      contractType: { select: { id: true, name: true, code: true } },
      plannedStartDate: true,
      actualStartDate: true,
      contractStartDate: true,
      contractEndDate: true,
      probationMonths: true,
      payrollApplicable: true,
      clientAssignedRole: true,
      introSentence: true,
      hobbies: true,
      msAccountRequired: true,
      laptopRequired: true,
      accessCardRequired: true,
      itReadinessConfirmed: true,
      itReadinessAt: true,
      itReadinessBy: { select: { id: true, name: true } },
      itIntakeSubmittedAt: true,
      itIntakeReference: true,
      itIntakeError: true,
      sourceRef: true,
    },
  },
  employee: {
    select: {
      id: true,
      odooId: true,
      employeeCode: true,
      status: true,
      name: true,
      email: true,
      personalEmail: true,
      personalPhone: true,
      nationality: true,
      entityId: true,
      entity: { select: { id: true, code: true, name: true } },
      departmentId: true,
      department: {
        select: { id: true, name: true, directorate: { select: { id: true, name: true } } },
      },
      teamId: true,
      roleTrack: true,
      jobTitle: true,
      contractType: true,
      workLocation: true,
      managerId: true,
      manager: { select: { id: true, name: true, email: true } },
      basicSalaryEnc: true,
      userId: true,
      dateOfJoining: true,
      probationEndDate: true,
    },
  },
} as const satisfies Prisma.JmlCaseSelect;

export type JoinerRow = Prisma.JmlCaseGetPayload<{ select: typeof JOINER_SELECT }>;

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export function joinerSubject(e: {
  entityId: string;
  departmentId: string | null;
  department: { directorate: { id: string } | null } | null;
}): ScopeSubject {
  return {
    entityId: e.entityId,
    departmentId: e.departmentId,
    directorateId: e.department?.directorate?.id ?? null,
  };
}

type Detail = NonNullable<JoinerRow["joinDetail"]>;

/** A draft opened without details reads as all-unanswered (never a crash on a missing row). */
const EMPTY_DETAIL: Detail = {
  contractTypeId: null,
  contractType: null,
  plannedStartDate: null,
  actualStartDate: null,
  contractStartDate: null,
  contractEndDate: null,
  probationMonths: null,
  payrollApplicable: true,
  clientAssignedRole: null,
  introSentence: null,
  hobbies: null,
  msAccountRequired: null,
  laptopRequired: null,
  accessCardRequired: null,
  itReadinessConfirmed: false,
  itReadinessAt: null,
  itReadinessBy: null,
  itIntakeSubmittedAt: null,
  itIntakeReference: null,
  itIntakeError: null,
  sourceRef: null,
};

function caseView(row: JoinerRow) {
  return {
    caseId: row.id,
    caseRef: row.status === "DRAFT" ? null : row.caseRef,
    status: row.status,
    stage: row.stage,
    version: row.version,
    completionPct: row.completionPct,
    activatedAt: row.activatedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    duplicateOverrideReason: row.duplicateOverrideReason,
    legalHold: row.legalHold,
    legalHoldReason: row.legalHoldReason,
    archivedAt: row.archivedAt,
    anonymisedAt: row.anonymisedAt,
    createdAt: row.createdAt,
    hrOwner: row.hrOwner,
    seniorHr: row.seniorHr,
    template: row.template,
  };
}

function employeeView(e: JoinerRow["employee"]) {
  return {
    employeeId: e.id,
    employeeStatus: e.status,
    odooId: isProvisionalOdooId(e.odooId) ? null : e.odooId,
    employeeCode: e.employeeCode,
    fullName: e.name,
    workEmail: isPlaceholderEmail(e.email) ? null : e.email,
    personalEmail: e.personalEmail,
    phone: e.personalPhone,
    nationality: e.nationality,
    entity: e.entity,
    entityId: e.entityId,
    departmentId: e.departmentId,
    department: e.department ? { id: e.department.id, name: e.department.name } : null,
    directorate: e.department?.directorate ?? null,
    teamId: e.teamId,
    roleTrack: e.roleTrack,
    jobTitle: e.jobTitle,
    employmentType: e.contractType,
    workLocation: e.workLocation,
    managerId: e.managerId,
    manager: e.manager,
    hasLogin: e.userId !== null,
    probationEndDate: day(e.probationEndDate),
  };
}

function detailView(d: Detail) {
  return {
    ...d,
    plannedStartDate: day(d.plannedStartDate),
    actualStartDate: day(d.actualStartDate),
    contractStartDate: day(d.contractStartDate),
    contractEndDate: day(d.contractEndDate),
  };
}

/** The joiner as the screens read it. Salary only when the actor may see it. */
export function serializeJoiner(row: JoinerRow, actor: JmlActor) {
  const e = row.employee;
  const salaryVisible = canFor(actor, "people.viewSalary", joinerSubject(e));
  return {
    ...caseView(row),
    ...employeeView(e),
    salaryVisible,
    salary: salaryVisible ? decryptSalary(e.basicSalaryEnc, e.odooId) : null,
    ...detailView(row.joinDetail ?? EMPTY_DETAIL),
  };
}

export async function loadJoinerRow(caseId: string): Promise<JoinerRow> {
  const row = await prisma.jmlCase.findUnique({ where: { id: caseId }, select: JOINER_SELECT });
  if (!row || !row.joinDetail) throw new JmlError("Joiner not found", 404);
  return row;
}

/**
 * Placement consistency on every write (Onboarding `new-hire.ts:149-184`,
 * against the core rules): the department belongs to the company, the team to
 * the department, and only C-Level sits without a department.
 */
export async function placementSubject(p: {
  entityId: string;
  departmentId: string | null;
  teamId: string | null;
  roleTrack: string;
}): Promise<ScopeSubject> {
  if (p.roleTrack === "C_LEVEL" && p.departmentId) {
    throw new JmlError("A C-Level joiner sits on the company, without a department.", 422);
  }
  if (p.roleTrack !== "C_LEVEL" && !p.departmentId) {
    throw new JmlError("Choose the department the joiner will sit in.", 422);
  }
  const company = await prisma.orgEntity.findUnique({
    where: { id: p.entityId },
    select: { id: true },
  });
  if (!company) throw new JmlError("That company does not exist.", 422);
  let directorateId: string | null = null;
  if (p.departmentId) {
    const dept = await prisma.department.findUnique({
      where: { id: p.departmentId },
      select: { entityId: true, directorateId: true },
    });
    if (!dept) throw new JmlError("That department does not exist.", 422);
    if (dept.entityId !== p.entityId) {
      throw new JmlError("That department belongs to a different company.", 409);
    }
    directorateId = dept.directorateId;
  }
  const team = await teamPlacementProblem(p.teamId, p.departmentId);
  if (team) {
    const sentence = team.replace(/^teamId: /, "");
    throw new JmlError(`${sentence[0]!.toUpperCase()}${sentence.slice(1)}.`, 409);
  }
  return { entityId: p.entityId, departmentId: p.departmentId, directorateId };
}
