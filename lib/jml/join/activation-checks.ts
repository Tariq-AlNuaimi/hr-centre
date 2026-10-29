import { prisma } from "@/lib/prisma";
import { canFor, type JmlActor } from "../access";
import { JmlError } from "../errors";
import { joinFacts } from "./facts";
import { joinerSubject, type JoinerRow } from "./joiner-data";

/**
 * The activation preconditions (Onboarding activation.ts:119-200 +
 * new-hire.ts readiness/directorate + duplicate.ts), shared by the preview and
 * the activation itself.
 */

export function factsOf(row: JoinerRow, companyCode: string | null) {
  return joinFacts({
    companyCode,
    employmentType: row.employee.contractType,
    contractTypeCode: row.joinDetail?.contractType?.code ?? null,
    nationality: row.employee.nationality,
    workLocation: row.employee.workLocation,
    payrollApplicable: row.joinDetail?.payrollApplicable ?? true,
    laptopRequired: row.joinDetail?.laptopRequired ?? null,
    accessCardRequired: row.joinDetail?.accessCardRequired ?? null,
  });
}

export function placementOf(row: JoinerRow) {
  const e = row.employee;
  return {
    entityId: e.entityId,
    directorateId: e.department?.directorate?.id ?? null,
    departmentId: e.departmentId,
  };
}

export function assertActivatable(row: JoinerRow) {
  if (row.employee.status !== "PRE_JOINER") {
    throw new JmlError(
      `${row.employee.name} is already an employee and is not onboarded. Start an internal change from their record instead.`,
      409,
    );
  }
  if (row.status !== "DRAFT") {
    throw new JmlError(`${row.employee.name} is already activated as ${row.caseRef}.`, 409);
  }
}

export function candidateOf(row: JoinerRow) {
  const e = row.employee;
  const d = row.joinDetail;
  return {
    fullName: e.name,
    personalEmail: e.personalEmail,
    nationality: e.nationality,
    entityId: e.entityId,
    departmentId: e.departmentId,
    roleTrack: e.roleTrack,
    jobTitle: e.jobTitle,
    employmentType: e.contractType,
    contractTypeId: d?.contractTypeId ?? null,
    plannedStartDate: d?.plannedStartDate ?? null,
    managerId: e.managerId,
    msAccountRequired: d?.msAccountRequired ?? null,
    laptopRequired: d?.laptopRequired ?? null,
    accessCardRequired: d?.accessCardRequired ?? null,
  };
}

/** §9.2 "Directorate — required where structure applies", read off the data. */
export async function directorateProblem(row: JoinerRow): Promise<string | null> {
  const e = row.employee;
  if (e.roleTrack === "C_LEVEL" || e.department?.directorate) return null;
  const structured = await prisma.directorate.count({ where: { entityId: e.entityId } });
  return structured > 0
    ? "This company is organised into directorates, so the joiner's department needs one before activation."
    : null;
}

/** People already on file with this personal email (rehire allowed only with a reason). */
export async function emailDuplicates(row: JoinerRow) {
  const email = row.employee.personalEmail;
  if (!email) return [];
  return prisma.employee.findMany({
    where: {
      id: { not: row.employee.id },
      personalEmail: { equals: email, mode: "insensitive" },
      // A pre-joiner whose every onboarding was cancelled is not a duplicate.
      NOT: {
        status: "PRE_JOINER",
        jmlCases: { none: { caseType: "JOIN", status: { not: "CANCELLED" } } },
      },
    },
    select: { id: true, name: true, employeeCode: true, status: true },
    take: 5,
  });
}

export async function duplicateProblem(
  actor: JmlActor,
  row: JoinerRow,
  overrideReason: string | undefined,
): Promise<string | null> {
  const dupes = await emailDuplicates(row);
  if (dupes.length === 0) return null;
  const names = dupes.map((d) => d.name).join(", ");
  const email = row.employee.personalEmail;
  if (!canFor(actor, "jml.supervise", joinerSubject(row.employee))) {
    return `${email} is already used by ${names}. A Senior HR user or the HR Manager can activate anyway with a recorded reason.`;
  }
  return overrideReason
    ? null
    : `${email} is already used by ${names}. Give a reason to activate anyway — it is recorded on the case.`;
}
