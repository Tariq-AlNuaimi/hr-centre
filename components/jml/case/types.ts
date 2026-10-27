/** The case detail as GET /api/jml/cases/[id] returns it (lib/jml/engine/case-read.ts). */
export type CaseDetail = {
  id: string;
  caseRef: string;
  caseType: "JOIN" | "MOVE" | "LEAVE";
  exitType: string | null;
  status: string;
  stage: string;
  completionPct: number;
  version: number;
  activatedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  duplicateOverrideReason: string | null;
  archivedAt: string | null;
  legalHold: boolean;
  legalHoldReason: string | null;
  anonymisedAt: string | null;
  hrOwner: { id: string; name: string | null; email: string } | null;
  seniorHr: { id: string; name: string | null } | null;
  lastUpdatedBy: { id: string; name: string | null } | null;
  template: { id: string; name: string; version: number } | null;
  joinDetail: {
    plannedStartDate: string | null;
    actualStartDate: string | null;
    contractType: { name: string } | null;
    payrollApplicable: boolean;
    itReadinessConfirmed: boolean;
    itReadinessAt: string | null;
    itIntakeSubmittedAt: string | null;
    itIntakeReference: string | null;
    itIntakeError: string | null;
  } | null;
  moveDetail: {
    changeType: string;
    effectiveDate: string;
    previousDetails: Record<string, { value: string | null; label: string | null }>;
    newDetails: Record<string, { value: string | null; label: string | null }>;
    appliedAt: string | null;
    applyNote: string | null;
  } | null;
  employee: {
    id: string;
    odooId: string | null;
    employeeCode: string | null;
    status: string;
    name: string;
    jobTitle: string | null;
    contractType: string | null;
    nationality: string | null;
    entity: { name: string };
    department: { name: string; directorate: { name: string } | null } | null;
    manager: { id: string; name: string } | null;
  };
  externalLinks: Array<{ key: "odoo" | "staffing-form"; url: string | null }>;
  taskStatuses: string[];
  can: {
    manage: boolean;
    workTasks: boolean;
    reopenTasks: boolean;
    supervise: boolean;
    close: boolean;
  };
};

export type TaskDto = {
  id: string;
  code: string;
  name: string;
  stage: string;
  source: "TEMPLATE" | "MANUAL" | "REVERSAL";
  status: string;
  dueDate: string | null;
  dueDateOverrideReason: string | null;
  mandatory: boolean;
  blocking: boolean;
  confirmationRequired: boolean;
  confirmingParty: string | null;
  confirmationDate: string | null;
  externalReference: string | null;
  notApplicableReason: string | null;
  delayReason: string | null;
  statutory: boolean;
  complianceCategory: string | null;
  completedAt: string | null;
  version: number;
  owner: { id: string; name: string | null } | null;
  completedBy: { id: string; name: string | null } | null;
  _count: { comments: number };
};

export const LIVE = new Set(["ACTIVE", "AT_RISK", "PENDING_SETTLEMENT"]);
