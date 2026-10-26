import type { JoinerValues } from "./JoinerFields";

/** The joiner as the API returns it (lib/jml/join/joiner-data.ts serializeJoiner). */
export type JoinerDto = {
  caseId: string;
  caseRef: string | null;
  status: string;
  version: number;
  employeeId: string;
  employeeStatus: string;
  employeeCode: string | null;
  fullName: string;
  workEmail: string | null;
  personalEmail: string | null;
  phone: string | null;
  nationality: string | null;
  entityId: string;
  departmentId: string | null;
  teamId: string | null;
  roleTrack: string;
  jobTitle: string | null;
  employmentType: string | null;
  contractTypeId: string | null;
  plannedStartDate: string | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  probationMonths: number | null;
  workLocation: string | null;
  manager: { id: string; name: string } | null;
  salaryVisible: boolean;
  salary: string | null;
  payrollApplicable: boolean;
  clientAssignedRole: boolean | null;
  introSentence: string | null;
  hobbies: string | null;
  msAccountRequired: boolean | null;
  laptopRequired: boolean | null;
  accessCardRequired: boolean | null;
  sourceRef: string | null;
};

export const BLANK: JoinerValues = {
  fullName: "",
  workEmail: "",
  personalEmail: "",
  phone: "",
  nationality: "",
  entityId: "",
  departmentId: "",
  teamId: "",
  roleTrack: "INDIVIDUAL",
  jobTitle: "",
  employmentType: "",
  contractTypeId: "",
  plannedStartDate: "",
  contractStartDate: "",
  contractEndDate: "",
  probationMonths: "",
  workLocation: "",
  manager: null,
  salary: "",
  payrollApplicable: true,
  clientAssignedRole: null,
  introSentence: "",
  hobbies: "",
  msAccountRequired: null,
  laptopRequired: null,
  accessCardRequired: null,
};

export function valuesOf(j: JoinerDto): JoinerValues {
  return {
    fullName: j.fullName,
    workEmail: j.workEmail ?? "",
    personalEmail: j.personalEmail ?? "",
    phone: j.phone ?? "",
    nationality: j.nationality ?? "",
    entityId: j.entityId,
    departmentId: j.departmentId ?? "",
    teamId: j.teamId ?? "",
    roleTrack: j.roleTrack,
    jobTitle: j.jobTitle ?? "",
    employmentType: j.employmentType ?? "",
    contractTypeId: j.contractTypeId ?? "",
    plannedStartDate: j.plannedStartDate ?? "",
    contractStartDate: j.contractStartDate ?? "",
    contractEndDate: j.contractEndDate ?? "",
    probationMonths: j.probationMonths === null ? "" : String(j.probationMonths),
    workLocation: j.workLocation ?? "",
    manager: j.manager ? { id: j.manager.id, name: j.manager.name } : null,
    salary: j.salary ?? "",
    payrollApplicable: j.payrollApplicable,
    clientAssignedRole: j.clientAssignedRole,
    introSentence: j.introSentence ?? "",
    hobbies: j.hobbies ?? "",
    msAccountRequired: j.msAccountRequired,
    laptopRequired: j.laptopRequired,
    accessCardRequired: j.accessCardRequired,
  };
}

const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

/**
 * The request body. On an edit only CHANGED fields are sent, so a field the
 * actor may not change (salary without the permission, the start date of an
 * active case) is never sent back unchanged and refused.
 */
export function payloadOf(
  v: JoinerValues,
  initial: JoinerValues | null,
  salaryAllowed: boolean,
): Record<string, unknown> {
  const full: Record<string, unknown> = {
    fullName: v.fullName.trim(),
    workEmail: orNull(v.workEmail),
    personalEmail: orNull(v.personalEmail),
    phone: orNull(v.phone),
    nationality: orNull(v.nationality),
    entityId: v.entityId,
    departmentId: v.roleTrack === "C_LEVEL" ? null : orNull(v.departmentId),
    teamId: orNull(v.teamId),
    roleTrack: v.roleTrack,
    jobTitle: orNull(v.jobTitle),
    employmentType: orNull(v.employmentType),
    contractTypeId: orNull(v.contractTypeId),
    plannedStartDate: orNull(v.plannedStartDate),
    contractStartDate: orNull(v.contractStartDate),
    contractEndDate: orNull(v.contractEndDate),
    probationMonths: v.probationMonths.trim() === "" ? null : Number(v.probationMonths),
    workLocation: orNull(v.workLocation),
    managerId: v.manager?.id ?? null,
    payrollApplicable: v.payrollApplicable,
    clientAssignedRole: v.clientAssignedRole,
    introSentence: orNull(v.introSentence),
    hobbies: orNull(v.hobbies),
    msAccountRequired: v.msAccountRequired,
    laptopRequired: v.laptopRequired,
    accessCardRequired: v.accessCardRequired,
    ...(salaryAllowed ? { salary: orNull(v.salary) } : {}),
  };
  if (!initial) return full;
  const before = payloadOf(initial, null, salaryAllowed);
  return Object.fromEntries(
    Object.entries(full).filter(([k, val]) => JSON.stringify(before[k]) !== JSON.stringify(val)),
  );
}
