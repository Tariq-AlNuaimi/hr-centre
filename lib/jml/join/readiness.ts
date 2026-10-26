/**
 * Activation readiness — HR Onboarding `missingActivationFields` (AC-NEW-002),
 * pure. Every missing field is reported at once so the screen can mark them
 * all. The three IT answers are checked for NULL, never for `false`: "no
 * laptop" is an answer, "nobody asked" is not.
 */

export type ActivationCandidate = {
  fullName: string | null;
  personalEmail: string | null;
  nationality: string | null;
  entityId: string | null;
  departmentId: string | null;
  roleTrack: string;
  jobTitle: string | null;
  employmentType: string | null;
  contractTypeId: string | null;
  plannedStartDate: unknown;
  managerId: string | null;
  msAccountRequired: boolean | null;
  laptopRequired: boolean | null;
  accessCardRequired: boolean | null;
};

export const ACTIVATION_FIELD_LABEL: Record<string, string> = {
  fullName: "Full name",
  personalEmail: "Personal email",
  nationality: "Nationality",
  entityId: "Company",
  departmentId: "Department",
  jobTitle: "Job title",
  employmentType: "Employment type",
  contractTypeId: "Contract type",
  plannedStartDate: "Planned start date",
  managerId: "Line manager",
  msAccountRequired: "Microsoft account required",
  laptopRequired: "Laptop required",
  accessCardRequired: "Access card required",
};

const REQUIRED = [
  "fullName",
  "personalEmail",
  "nationality",
  "entityId",
  "departmentId",
  "jobTitle",
  "employmentType",
  "contractTypeId",
  "plannedStartDate",
  "managerId",
] as const;

const IT_ANSWERS = ["msAccountRequired", "laptopRequired", "accessCardRequired"] as const;

export function missingActivationFields(c: ActivationCandidate): string[] {
  const missing: string[] = [];
  for (const field of REQUIRED) {
    // C-Level sits on the company without a department (core rule).
    if (field === "departmentId" && c.roleTrack === "C_LEVEL") continue;
    const value = c[field];
    if (value === null || value === undefined || value === "") {
      missing.push(ACTIVATION_FIELD_LABEL[field]!);
    }
  }
  for (const field of IT_ANSWERS) {
    if (c[field] === null || c[field] === undefined) missing.push(ACTIVATION_FIELD_LABEL[field]!);
  }
  return missing;
}

/** The refusal sentence, or null when nothing is missing. */
export function readinessProblem(c: ActivationCandidate): string | null {
  const missing = missingActivationFields(c);
  return missing.length > 0
    ? `Complete these fields before activating: ${missing.join(", ")}`
    : null;
}
