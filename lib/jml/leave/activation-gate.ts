import { checkTerminationAuthorisation } from "./approval-rules";
import { DOCUMENTED_EXIT_TYPES, dateProblems, type DateFacts, type Problem } from "./rules";

/**
 * Offboarding `checkActivationGate` (pure): collects EVERY blocker. F12 fixed:
 * the date-order rules run again here — a draft saved before them cannot
 * activate with LDS < LPWD.
 */

export type LeaveActivationCandidate = DateFacts & {
  status: string;
  lineManagerEmployeeId: string | null;
  docRefPerformanceHistory: string | null;
  docRefWrittenGrounds: string | null;
  docRefLegalReview: string | null;
  approvals: readonly { approvalType: string; holderRoleKey: string; status: string }[];
};

function terminationProblems(c: LeaveActivationCandidate): Problem[] {
  const out: Problem[] = [];
  if (!c.docRefPerformanceHistory) {
    out.push({
      field: "docRefPerformanceHistory",
      message: "Performance history reference is required.",
    });
  }
  if (!c.docRefWrittenGrounds) {
    out.push({ field: "docRefWrittenGrounds", message: "Written grounds reference is required." });
  }
  if (!c.docRefLegalReview) {
    out.push({
      field: "docRefLegalReview",
      message: "Legal or external review reference is required.",
    });
  }
  const auth = checkTerminationAuthorisation(c.approvals);
  if (!auth.granted) {
    const refused = auth.rejectedHolders.length
      ? ` ${auth.rejectedHolders.join(" and ")} REFUSED it — a refusal has to be resolved, not re-requested.`
      : "";
    out.push({
      field: "terminationAuthorisation",
      message: `Termination Authorisation is not granted. Outstanding: ${auth.missingHolders.join(", ")}.${refused}`,
    });
  }
  return out;
}

export function leaveActivationProblems(c: LeaveActivationCandidate): Problem[] {
  const out: Problem[] = [];
  if (c.status !== "DRAFT")
    out.push({
      field: "status",
      message: `Only a draft case can be activated; this is ${c.status.toLowerCase()}.`,
    });
  if (!c.lastPhysicalWorkingDay)
    out.push({
      field: "lastPhysicalWorkingDay",
      message: "Last Physical Working Day is required.",
    });
  if (!c.lastDayOfService)
    out.push({ field: "lastDayOfService", message: "Last Day of Service is required." });
  if (!c.lineManagerEmployeeId) {
    out.push({
      field: "lineManager",
      message: "A line manager is required — set one on the employee record.",
    });
  }
  out.push(...dateProblems(c));
  if (DOCUMENTED_EXIT_TYPES.has(c.exitType)) out.push(...terminationProblems(c));
  return out;
}
