import type {
  AbsentEmployee,
  FieldChange,
  ImportIssue,
  PlannedCreate,
  PlannedUpdate,
  ValidatedRow,
} from "./types";
import {
  ID_DOCUMENT_FIELDS,
  PERSONAL_FIELDS,
  RECORD_FIELDS,
  type EmployeeRecordInput,
} from "@/lib/people/record";

/**
 * Reconciliation — spec §3.5 (re-import / refresh behavior, mid-cycle).
 *
 * "The employee list is refreshable during the year (joiners, transfers,
 * leavers):
 *    - New rows → create the employee, pull them into the cycle.
 *    - Changed rows → update the record.
 *    - Missing rows → change nothing. Absence from a file is never interpreted
 *      as a departure. (Protects against truncated/filtered exports wiping
 *      people.)"
 *
 * The third bullet is the load-bearing one, and it is why this file computes a
 * PLAN rather than performing writes. There is no delete path here — not
 * disabled, not commented out, not behind a flag. Appendix A states it as an
 * invariant ("Silence is never destructive"), and the way to make an invariant
 * hold is to leave out the code that could violate it.
 *
 * Absent employees are still ENUMERATED, as `ABSENT_NO_CHANGE`. "Nothing
 * happens to these 28 people" shown on screen is a reviewable fact; "nothing
 * happens" left implicit is something HR has to take on trust.
 */

/** An existing employee, as the reconciler needs to see it. */
export type ExistingEmployee = {
  id: string;
  odooId: string;
  name: string;
  email: string;
  departmentId: string | null;
  entityId: string;
  managerId: string | null;
  roleTrack: string;
  /** Decimal serialised to string, or null. Never rendered — see `diffFields`. */
  basicSalary: string | null;
  status: string;
  dateOfJoining: Date | null;
  lastWorkingDay: Date | null;
  unpaidLeaveDays: number;
  /** F-a. Optional so Performance-era fixtures still type-check. */
  teamId?: string | null;
  /**
   * F-b — the record as on file, natural form (ID numbers decrypted in memory
   * for comparison only; `undefined` for a number the key could not open).
   */
  record?: EmployeeRecordInput;
};

export type ReconcileContext = {
  existing: Map<string, ExistingEmployee>;
  /** Department id → display name, for a readable create plan. */
  departmentNames: Map<string, string>;
  /** Entity id → code, likewise. */
  entityCodes: Map<string, string>;
  /** F-a — teamId → name, so the preview shows "Data → Platform", not two ids. */
  teamNames?: Map<string, string>;
};

/**
 * F-a — the team a row will actually end up with. A sheet without a Team
 * column keeps the team on file, but only while the department is unchanged: a
 * team never follows its member into another department (the database would
 * refuse it anyway — `employees_team_department_agree_fkey`).
 */
export function effectiveTeamId(
  incoming: Pick<ValidatedRow, "teamId" | "departmentId">,
  existing: Pick<ExistingEmployee, "teamId" | "departmentId"> | undefined,
): string | null {
  if (incoming.teamId !== undefined) return incoming.teamId;
  if (!existing || existing.departmentId !== incoming.departmentId) return null;
  return existing.teamId ?? null;
}

export type ReconcilePlan = {
  creates: PlannedCreate[];
  updates: PlannedUpdate[];
  absent: AbsentEmployee[];
  /** WARNING-severity findings raised by reconciliation itself (see below). */
  issues: ImportIssue[];
};

/**
 * Fields compared to decide whether a row is a change. Restricted salary is
 * handled separately in `diffFields` — it is compared, but never rendered.
 */
const COMPARED_FIELDS = [
  "name",
  "email",
  "departmentId",
  "entityId",
  "managerId",
  "roleTrack",
  "status",
  "dateOfJoining",
  "lastWorkingDay",
  "unpaidLeaveDays",
  "basicSalary",
  "teamId",
] as const;

function dateKey(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/**
 * Build the change list between an existing employee and an incoming row.
 *
 * `basicSalary` is compared like everything else — HR must see that pay changed
 * — but its from/to are rendered as the literal string `"[redacted]"`, never the
 * figures. The preview is visible to HRBP and is persisted to
 * `ImportBatch.previewJson`; emitting the numbers here would put Restricted data
 * (§4.5/§11.6) into a payload and a table that the field-level access rule
 * otherwise keeps it out of, and would defeat `SCRUB_FIELDS` by laundering the
 * value through a differently-named column.
 */
function diffFields(
  existing: ExistingEmployee,
  incoming: ValidatedRow,
  managerId: string | null,
  teamNames: Map<string, string> | undefined,
): FieldChange[] {
  const teamLabel = (id: string | null) => (id ? (teamNames?.get(id) ?? id) : null);
  const next: Record<(typeof COMPARED_FIELDS)[number], string | null> = {
    name: incoming.name,
    email: incoming.email,
    departmentId: incoming.departmentId,
    entityId: incoming.entityId,
    managerId,
    roleTrack: incoming.roleTrack,
    status: incoming.status,
    dateOfJoining: dateKey(incoming.dateOfJoining),
    lastWorkingDay: dateKey(incoming.lastWorkingDay),
    unpaidLeaveDays: String(incoming.unpaidLeaveDays),
    basicSalary: incoming.basicSalary,
    teamId: teamLabel(effectiveTeamId(incoming, existing)),
  };

  const before: Record<(typeof COMPARED_FIELDS)[number], string | null> = {
    name: existing.name,
    email: existing.email,
    departmentId: existing.departmentId,
    entityId: existing.entityId,
    managerId: existing.managerId,
    roleTrack: existing.roleTrack,
    status: existing.status,
    dateOfJoining: dateKey(existing.dateOfJoining),
    lastWorkingDay: dateKey(existing.lastWorkingDay),
    unpaidLeaveDays: String(existing.unpaidLeaveDays),
    basicSalary: existing.basicSalary,
    teamId: teamLabel(existing.teamId ?? null),
  };

  const changes: FieldChange[] = recordChanges(existing.record ?? {}, incoming.record ?? {});
  for (const field of COMPARED_FIELDS) {
    const from = before[field];
    const to = next[field];

    if (field === "basicSalary") {
      // Compared numerically, so 4200 and "4200.000" are not a spurious change.
      const same =
        (from == null && to == null) || (from != null && to != null && Number(from) === Number(to));
      if (!same) changes.push({ field, from: "[redacted]", to: "[redacted]" });
      continue;
    }

    if (from !== to) changes.push({ field, from, to });
  }

  return changes;
}

/**
 * Compute the plan. Pure: no database access, no writes, fully testable.
 *
 * Manager resolution happens here rather than in validation because it needs
 * both halves of the world at once — a manager may be an existing employee
 * (resolve to their id) or another row in the same file (resolve to the id that
 * row's create will produce, which is why `managerId` is left null on creates
 * and linked in a second pass at apply time; see run.ts).
 */
/** Personal and ID-document values never appear in a stored preview — only that they change. */
const REDACTED_IN_PREVIEW = new Set<string>([...PERSONAL_FIELDS, ...ID_DOCUMENT_FIELDS]);

function recordValueKey(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/**
 * F-b — compare only the record fields the file actually carries; an absent
 * column is "leave alone", never a change.
 */
function recordChanges(before: EmployeeRecordInput, after: EmployeeRecordInput): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of RECORD_FIELDS) {
    if (after[field] === undefined) continue;
    const from = recordValueKey(before[field]);
    const to = recordValueKey(after[field]);
    if (from === to) continue;
    changes.push(
      REDACTED_IN_PREVIEW.has(field)
        ? { field, from: "[redacted]", to: "[redacted]" }
        : { field, from, to },
    );
  }
  return changes;
}

export function reconcile(rows: ValidatedRow[], ctx: ReconcileContext): ReconcilePlan {
  const creates: PlannedCreate[] = [];
  const updates: PlannedUpdate[] = [];
  const issues: ImportIssue[] = [];

  const odooIdsInFile = new Set(rows.map((r) => r.odooId));

  for (const row of rows) {
    const existing = ctx.existing.get(row.odooId);

    // Resolve the manager to a database id when the manager already exists.
    // When the manager is another NEW row in this file, they have no id yet;
    // that link is completed after the creates land (run.ts).
    const managerExisting = row.managerOdooId ? ctx.existing.get(row.managerOdooId) : undefined;
    const managerId = managerExisting?.id ?? null;

    if (!existing) {
      creates.push({
        action: "CREATE",
        rowNumber: row.rowNumber,
        odooId: row.odooId,
        name: row.name,
        email: row.email,
        departmentName: row.departmentId
          ? (ctx.departmentNames.get(row.departmentId) ?? null)
          : null,
        entityCode: ctx.entityCodes.get(row.entityId) ?? row.entityId,
        roleTrack: row.roleTrack,
        status: row.status,
      });
      continue;
    }

    const changes = diffFields(existing, row, managerId ?? existing.managerId, ctx.teamNames);

    // §3.2 — "IDs must never shift on re-import." So an existing odooId arriving
    // with a different NAME is applied, not refused: people marry, transliterate
    // differently, or were entered wrong the first time. But it is also exactly
    // what a reused-ID data-entry error looks like — one person's record quietly
    // becoming another's. Refusing it would break the spec; applying it silently
    // would hide the overwrite. So: applied, and surfaced as a WARNING.
    const nameChanged = changes.some((c) => c.field === "name");
    if (nameChanged) {
      issues.push({
        rowNumber: row.rowNumber,
        odooId: row.odooId,
        field: "name",
        rule: "identity_changed_on_stable_id",
        message:
          `Employee ID "${row.odooId}" is on file as "${existing.name}" but this row says ` +
          `"${row.name}". The record will be updated in place. Check this is a rename and ` +
          `not a reused ID.`,
        severity: "WARNING",
      });
    }

    if (changes.length === 0) continue;

    updates.push({
      action: "UPDATE",
      rowNumber: row.rowNumber,
      odooId: row.odooId,
      employeeId: existing.id,
      name: row.name,
      changes,
    });
  }

  // §3.5 — employees the file does not mention. Listed so the "no change" is
  // visible; acted on by nothing.
  const absent: AbsentEmployee[] = [];
  for (const employee of ctx.existing.values()) {
    if (odooIdsInFile.has(employee.odooId)) continue;
    absent.push({
      action: "ABSENT_NO_CHANGE",
      employeeId: employee.id,
      odooId: employee.odooId,
      name: employee.name,
    });
  }

  return { creates, updates, absent, issues };
}
