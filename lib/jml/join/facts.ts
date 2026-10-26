import type { ConditionFacts } from "../engine/conditions";

/**
 * The five (six) facts template criteria and task conditions read for a joiner
 * or a mover's NEW position (Onboarding §14). Company and contract type are
 * matched by CODE (RIHAL, UNLIMITED…) — what HR types in the template editor —
 * and payroll as "yes"/"no" (8.4.12 fixed: payroll is a condition fact).
 */
export function joinFacts(p: {
  companyCode: string | null;
  employmentType: string | null;
  contractTypeCode: string | null;
  nationality: string | null;
  workLocation: string | null;
  payrollApplicable: boolean | null;
}): ConditionFacts {
  return {
    companyId: p.companyCode,
    employmentType: p.employmentType,
    contractTypeId: p.contractTypeCode,
    nationality: p.nationality,
    workLocation: p.workLocation,
    payrollApplicable: p.payrollApplicable === null ? null : p.payrollApplicable ? "yes" : "no",
  };
}
