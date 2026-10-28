import type { JmlAssigneeRole } from "../generated/prisma/client";

/**
 * JML task routing — who each SEEDED template task is for (docs/blueprints/
 * jml-task-routing.md, "Template mapping"). Only tasks whose text clearly
 * belongs to IT, Finance or the line manager are listed; everything else stays
 * HR. "Instruct IT / Finance to …" and "Submit IT request" stay HR: the HR
 * owner is the one instructing.
 *
 * Used twice, and a contract test keeps the two in step:
 *   - the seed creates new template rows with these roles;
 *   - migration 20261028101456_jml_task_routing back-fills the SAME roles onto
 *     the rows already seeded in production (once, by template name + code +
 *     unchanged task name, so a task HR renamed is left alone).
 */

type RoleMap = Readonly<Record<string, Exclude<JmlAssigneeRole, "HR">>>;

const LEAVE: RoleMap = {
  "S1-05": "IT", // Execute immediate access revocation and asset recovery before notification
  "S1-07": "LINE_MANAGER", // Line Manager and management confirm the exit
  "S3-02": "LINE_MANAGER", // Confirm handover completion with the line manager
  "S3-04": "IT", // IT confirms access revocation complete
  "S3-05": "IT", // IT confirms shared and service credentials rotated
  "S3-06": "IT", // Confirm company asset return to IT with condition check
  "S3-07": "IT", // Disable the email account (confirmed by IT)
  "S3-08": "IT", // Remove from email distribution lists (confirmed by IT)
  "S3-09": "IT", // Mailbox and file disposition
  "S4-06": "FINANCE", // Confirm settlement payment executed and record payment reference
};

const PAYROLL_TO_FINANCE: RoleMap = { T20: "FINANCE" };

export const SEEDED_ASSIGNEE_ROLES: Readonly<Record<string, RoleMap>> = {
  "Standard onboarding (§10.2 starter)": {
    T20: "LINE_MANAGER", // Welcome employee
    T22: "IT", // Hand over laptop
    T23: "IT", // Confirm credentials shared
    T24: "IT", // Confirm access card issued
    T40: "FINANCE", // Add employee to payroll sheet when Payroll Applicable = Yes
    T43: "IT", // Add employee to employee distribution list
  },
  "Internship to training (starter)": {
    T20: "FINANCE", // Add employee to payroll sheet
    T21: "LINE_MANAGER", // Agree training plan with line manager
  },
  "Internship to employment (starter)": PAYROLL_TO_FINANCE,
  "Training to employment (starter)": PAYROLL_TO_FINANCE,
  "Department transfer (starter)": {
    T20: "IT", // Update employee distribution lists
    T21: "LINE_MANAGER", // Complete handover from previous department
  },
  "Baseline offboarding — Full": LEAVE,
  "Baseline offboarding — Light": LEAVE,
};

/** The role a seeded template task is created with. */
export function seededAssigneeRole(templateName: string, code: string): JmlAssigneeRole {
  return SEEDED_ASSIGNEE_ROLES[templateName]?.[code] ?? "HR";
}
