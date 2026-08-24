import type { EmployeeSourceRow } from "../types";
import type { EmployeeStatus, RoleTrack } from "@/generated/prisma/client";
import type { ImportIssue } from "../types";
import { issue, normalize, ROLE_TRACK_ALIASES, STATUS_ALIASES, type Check } from "./shared";

/**
 * Who this row says the person IS — spec §3.4's identity rules plus the §3.3
 * fields the system cannot build a record without.
 *
 * These four checks share a property worth naming: none of them consult the
 * database. A malformed email or an unknown role track is wrong on its face, so
 * these run identically whether the row came from Excel today or from the Odoo
 * loader in v2.
 */

/** §3.4 — "Employee ID — present and unique". */
export function checkEmployeeId(
  row: EmployeeSourceRow,
  duplicateIds: Set<string>,
  idCounts: Map<string, number[]>,
): Check<string> {
  const odooId = row.odooId?.trim() ?? "";
  if (!odooId) {
    return {
      value: "",
      issues: [
        issue(row, "odooId", "employee_id_missing", "Employee ID is required and was blank."),
      ],
    };
  }
  if (duplicateIds.has(odooId)) {
    const where = (idCounts.get(odooId) ?? []).join(", ");
    return {
      value: odooId,
      issues: [
        issue(
          row,
          "odooId",
          "employee_id_duplicate",
          `Employee ID "${odooId}" appears on more than one row (rows ${where}). ` +
            `Each employee must appear once.`,
        ),
      ],
    };
  }
  return { value: odooId, issues: [] };
}

/**
 * §3.3 — name and email. Not in §3.4's bullet list, but §3.3 marks both as
 * required employee data and email is what the login and notification paths key
 * on; a row without them cannot produce a usable record.
 */
export function checkNameAndEmail(row: EmployeeSourceRow): Check<{ name: string; email: string }> {
  const issues: ImportIssue[] = [];

  const name = row.name?.trim() ?? "";
  if (!name) issues.push(issue(row, "name", "name_missing", "Name is required and was blank."));

  const email = row.email?.trim().toLowerCase() ?? "";
  if (!email) {
    issues.push(issue(row, "email", "email_missing", "Email is required and was blank."));
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    issues.push(
      issue(row, "email", "email_invalid", `"${row.email}" is not a valid email address.`),
    );
  }

  return { value: { name, email }, issues };
}

/** §3.4 — "Role Track — exactly one of the five valid values". */
export function checkRoleTrack(row: EmployeeSourceRow): Check<RoleTrack | null> {
  const raw = row.roleTrack?.trim() ?? "";
  const resolved = raw ? ROLE_TRACK_ALIASES[normalize(raw)] : undefined;
  if (resolved) return { value: resolved, issues: [] };

  return {
    value: null,
    issues: [
      issue(
        row,
        "roleTrack",
        "role_track_invalid",
        raw
          ? `"${raw}" is not a valid role track. Use one of: C-Level, Director, Manager, ` +
              `Lead, Individual.`
          : `Role track is required. Use one of: C-Level, Director, Manager, Lead, Individual.`,
      ),
    ],
  };
}

/**
 * §3.4 — "Status — Active or Leaver".
 *
 * A blank defaults to ACTIVE rather than rejecting: §3.3's own default is an
 * active employee, and a sheet that omits the column for a wholly-active org is
 * normal. A PRESENT but unrecognised value rejects — that is someone meaning
 * something the system cannot interpret.
 */
export function checkStatus(row: EmployeeSourceRow): Check<EmployeeStatus> {
  const raw = row.status?.trim() ?? "";
  if (!raw) return { value: "ACTIVE", issues: [] };

  const resolved = STATUS_ALIASES[normalize(raw)];
  if (resolved) return { value: resolved, issues: [] };

  return {
    value: "ACTIVE",
    issues: [
      issue(
        row,
        "status",
        "status_invalid",
        `"${raw}" is not a valid status. Use Active or Leaver.`,
      ),
    ],
  };
}
