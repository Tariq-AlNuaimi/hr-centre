import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canFor, subjectOf, type JmlActor } from "../access";
import { JmlError } from "../errors";
import { CHANGE_FIELDS, changeRefusal, type ChangeField, type EmployeeDetails } from "./rules";

/**
 * An employee as an internal change sees them (Onboarding `/employees/[id]`):
 * the current changeable details, the contract type from their onboarding,
 * whether they may change, and the history of their changes.
 */

export const MOVE_EMPLOYEE_SELECT = {
  id: true,
  name: true,
  status: true,
  employeeCode: true,
  roleTrack: true,
  nationality: true,
  entityId: true,
  departmentId: true,
  teamId: true,
  jobTitle: true,
  contractType: true,
  workLocation: true,
  managerId: true,
  entity: { select: { code: true, name: true } },
  department: { select: { name: true, directorateId: true } },
  manager: { select: { id: true, name: true } },
  jmlCases: {
    where: { caseType: "JOIN", status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      joinDetail: {
        select: {
          contractTypeId: true,
          payrollApplicable: true,
          contractType: { select: { code: true } },
        },
      },
    },
  },
} as const satisfies Prisma.EmployeeSelect;

export type MoveEmployee = Prisma.EmployeeGetPayload<{ select: typeof MOVE_EMPLOYEE_SELECT }>;

export function detailsOf(e: MoveEmployee): EmployeeDetails {
  return {
    entityId: e.entityId,
    departmentId: e.departmentId,
    teamId: e.teamId,
    jobTitle: e.jobTitle,
    employmentType: e.contractType,
    contractTypeId: e.jmlCases[0]?.joinDetail?.contractTypeId ?? null,
    workLocation: e.workLocation,
    managerId: e.managerId,
  };
}

export async function loadMoveEmployee(actor: JmlActor, employeeId: string) {
  const e = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: MOVE_EMPLOYEE_SELECT,
  });
  if (!e) throw new JmlError("Employee not found", 404);
  const subject = subjectOf(e);
  if (!canFor(actor, "jml.view", subject)) throw new JmlError("Employee not found", 404);
  return { employee: e, subject };
}

/** Display names for the id-valued fields, resolved now (snapshots keep them). */
export async function labelsFor(values: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(values.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const [entities, departments, teams, contractTypes, managers] = await Promise.all([
    prisma.orgEntity.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    prisma.department.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    prisma.team.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    prisma.jmlContractType.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    }),
    prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
  ]);
  return new Map(
    [...entities, ...departments, ...teams, ...contractTypes, ...managers].map((r) => [
      r.id,
      r.name,
    ]),
  );
}

const ID_FIELDS: ReadonlySet<ChangeField> = new Set([
  "entityId",
  "departmentId",
  "teamId",
  "contractTypeId",
  "managerId",
]);

export type Snapshot = Record<string, { value: string | null; label: string | null }>;

/** `{field: {value, label}}` of the changed fields only (Onboarding snapshots). */
export async function snapshots(
  previous: EmployeeDetails,
  next: EmployeeDetails,
  changed: ChangeField[],
) {
  const names = await labelsFor(
    changed.filter((f) => ID_FIELDS.has(f)).flatMap((f) => [previous[f] ?? "", next[f] ?? ""]),
  );
  const side = (d: EmployeeDetails): Snapshot =>
    Object.fromEntries(
      changed.map((f) => {
        const value = d[f] ?? null;
        return [
          f,
          { value, label: value && ID_FIELDS.has(f) ? (names.get(value) ?? null) : value },
        ];
      }),
    );
  return { previous: side(previous), next: side(next) };
}

/** The profile for the Start-a-change screen. */
export async function moveProfile(actor: JmlActor, employeeId: string) {
  const { employee, subject } = await loadMoveEmployee(actor, employeeId);
  const details = detailsOf(employee);
  const [names, history, openMove] = await Promise.all([
    labelsFor(CHANGE_FIELDS.map((f) => details[f] ?? "")),
    prisma.jmlCase.findMany({
      where: { employeeId, caseType: "MOVE" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        caseRef: true,
        status: true,
        createdAt: true,
        moveDetail: {
          select: {
            changeType: true,
            effectiveDate: true,
            previousDetails: true,
            newDetails: true,
            appliedAt: true,
          },
        },
      },
    }),
    prisma.jmlCase.findFirst({
      where: { employeeId, caseType: "MOVE", status: "ACTIVE" },
      select: { id: true, caseRef: true },
    }),
  ]);
  return {
    employee: {
      id: employee.id,
      name: employee.name,
      status: employee.status,
      employeeCode: employee.employeeCode,
      roleTrack: employee.roleTrack,
    },
    details,
    labels: Object.fromEntries(
      CHANGE_FIELDS.map((f) => [f, details[f] ? (names.get(details[f]!) ?? details[f]) : null]),
    ),
    refusal: changeRefusal(employee),
    canStart: canFor(actor, "jml.manageMovers", subject),
    openMove,
    history,
  };
}
