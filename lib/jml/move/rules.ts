import type { JmlChangeType } from "@/generated/prisma/client";
import { JmlError } from "../errors";

/**
 * Internal-change rules — HR Onboarding `change-rules.ts` (blueprint R1–R10),
 * ported on the core record's fields. Pure.
 *
 * Changeable fields (`CHANGE_FIELDS`): the placement (company, department,
 * team), job title, employment type, contract type, work location and line
 * manager. Salary is never part of a change (R10). `undefined` = keep,
 * `null` / "" = clear.
 */

export const CHANGE_FIELDS = [
  "entityId",
  "departmentId",
  "teamId",
  "jobTitle",
  "employmentType",
  "contractTypeId",
  "workLocation",
  "managerId",
] as const;

export type ChangeField = (typeof CHANGE_FIELDS)[number];
export type EmployeeDetails = { [K in ChangeField]: string | null };
export type ChangeDetailsInput = Partial<Record<ChangeField, string | null>>;

const INTERN_TYPES: ReadonlySet<string> = new Set(["INTERN", "SUMMER_INTERN"]);
const NOT_EMPLOYMENT: ReadonlySet<string> = new Set(["INTERN", "SUMMER_INTERN", "TRAINEE"]);

export function overlayDetails(
  current: EmployeeDetails,
  sent: ChangeDetailsInput,
): EmployeeDetails {
  const next = { ...current };
  for (const field of CHANGE_FIELDS) {
    const value = sent[field];
    if (value === undefined) continue;
    next[field] = value === "" ? null : value;
  }
  // A new company or department without a new team leaves no stale team behind.
  if (next.departmentId !== current.departmentId && sent.teamId === undefined) next.teamId = null;
  return next;
}

/** R4 eligibility: only a working employee changes; a pre-joiner is corrected, a leaver is gone. */
export function changeRefusal(employee: { name: string; status: string }): string | null {
  if (employee.status === "PRE_JOINER") {
    return `${employee.name} has not started yet. Correct the joiner's details, or confirm their actual start first.`;
  }
  if (employee.status !== "ACTIVE") {
    return `${employee.name} is no longer an active employee, so they cannot have an internal change.`;
  }
  return null;
}

function label(type: string | null): string {
  return type ? type.replaceAll("_", " ").toLowerCase() : "no employment type";
}

/** R5: what each change type allows, and what it forces. */
export function applyChangeRules(
  changeType: JmlChangeType,
  current: EmployeeDetails,
  next: EmployeeDetails,
): EmployeeDetails {
  const from = current.employmentType ?? "";
  switch (changeType) {
    case "INTERNSHIP_TO_TRAINING": {
      if (!INTERN_TYPES.has(from)) {
        throw new JmlError(
          `Internship to Training needs a current intern — this employee is ${label(current.employmentType)}`,
          422,
        );
      }
      if (
        next.employmentType &&
        next.employmentType !== from &&
        next.employmentType !== "TRAINEE"
      ) {
        throw new JmlError("Internship to Training makes the employee a trainee", 422);
      }
      return { ...next, employmentType: "TRAINEE" };
    }
    case "INTERNSHIP_TO_EMPLOYMENT":
    case "TRAINING_TO_EMPLOYMENT": {
      const intern = changeType === "INTERNSHIP_TO_EMPLOYMENT";
      if (intern ? !INTERN_TYPES.has(from) : from !== "TRAINEE") {
        throw new JmlError(
          `This change needs ${intern ? "a current intern" : "a current trainee"} — this employee is ${label(current.employmentType)}`,
          422,
        );
      }
      if (!next.employmentType || NOT_EMPLOYMENT.has(next.employmentType)) {
        throw new JmlError(
          "Choose the new employment type — employment means a type other than intern or trainee",
          422,
        );
      }
      return next;
    }
    case "DEPARTMENT_TRANSFER": {
      if (!next.departmentId) {
        throw new JmlError("Choose the department the employee is transferring to", 422);
      }
      if (next.departmentId === current.departmentId) {
        throw new JmlError("The new department is the employee's current department", 422);
      }
      return { ...next, employmentType: current.employmentType };
    }
  }
}

/** The fields that actually change. */
export function changedFields(previous: EmployeeDetails, next: EmployeeDetails): ChangeField[] {
  return CHANGE_FIELDS.filter((f) => (previous[f] ?? null) !== (next[f] ?? null));
}
