import type { EmployeeSourceRow, ImportIssue, ValidatedRow } from "./types";
import type { RoleTrack } from "@/generated/prisma/client";
import {
  checkEmployeeId,
  checkLastWorkingDay,
  checkManager,
  checkNameAndEmail,
  checkPlacement,
  checkRoleTrack,
  checkSalary,
  checkStatus,
  checkUnpaidLeave,
  issue,
  type ValidationContext,
} from "./checks";

export type { ValidationContext } from "./checks";

/**
 * Import validation — spec §3.4, batch level.
 *
 * "A row failing any rule is rejected/flagged, never silently accepted."
 *
 * The per-field rules live in `checks.ts`, one function per spec bullet. What
 * stays here is what genuinely needs the WHOLE file at once and cannot be
 * answered a row at a time:
 *
 *   - "Employee ID — present and unique" needs every other row's ID.
 *   - A manager may appear further DOWN the same sheet, so resolution needs the
 *     full set of IDs the file offers, not just the rows seen so far.
 *   - A reporting cycle (A→B→A) is a property of the graph, not of a row.
 */

export type ValidationResult = {
  validRows: ValidatedRow[];
  issues: ImportIssue[];
};

/**
 * Validate a whole batch.
 *
 * Batch-level, not row-level, because two of §3.4's rules are inherently about
 * the SET of rows and cannot be answered one row at a time: "Employee ID —
 * present and unique" needs every other row's ID, and manager resolution must
 * accept a manager who appears later in the same file.
 */
export function validateRows(rows: EmployeeSourceRow[], ctx: ValidationContext): ValidationResult {
  const issues: ImportIssue[] = [];
  const validRows: ValidatedRow[] = [];

  // --- Pass 1: uniqueness within the file -----------------------------------
  // Uniqueness against the DATABASE is deliberately NOT a rule: a repeat ID
  // there is the update path (§3.5), which is the whole point of a stable key.
  // Uniqueness within the FILE is a rule, because two rows claiming one ID make
  // the intended final state genuinely ambiguous.
  const idCounts = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.odooId) continue;
    const key = row.odooId.trim();
    const seen = idCounts.get(key);
    if (seen) seen.push(row.rowNumber);
    else idCounts.set(key, [row.rowNumber]);
  }
  const duplicateIds = new Set(
    [...idCounts.entries()].filter(([, rowNumbers]) => rowNumbers.length > 1).map(([id]) => id),
  );
  const idsInFile = new Set(idCounts.keys());

  // --- Pass 2: per-row rules ------------------------------------------------
  const accepted = new Map<string, ValidatedRow>();

  for (const row of rows) {
    const id = checkEmployeeId(row, duplicateIds, idCounts);
    const identity = checkNameAndEmail(row);
    const track = checkRoleTrack(row);
    const status = checkStatus(row);
    const placement = checkPlacement(row, track.value, ctx);
    const manager = checkManager(row, id.value, track.value, idsInFile, ctx);
    const salary = checkSalary(row);
    const lastWorkingDay = checkLastWorkingDay(row, status.value);
    const unpaidLeave = checkUnpaidLeave(row);

    const rowIssues = [
      ...id.issues,
      ...identity.issues,
      ...track.issues,
      ...status.issues,
      ...placement.issues,
      ...manager.issues,
      ...salary.issues,
      ...lastWorkingDay.issues,
      ...unpaidLeave.issues,
    ];

    if (rowIssues.length > 0) {
      issues.push(...rowIssues);
      continue;
    }

    // Every check passed, so the narrowing holds: a row reaching here has an id,
    // a name, a valid email, a role track, and a resolved entity.
    const validated: ValidatedRow = {
      rowNumber: row.rowNumber,
      odooId: id.value,
      name: identity.value.name,
      email: identity.value.email,
      departmentId: placement.value.departmentId,
      entityId: placement.value.entityId as string,
      managerOdooId: manager.value,
      roleTrack: track.value as RoleTrack,
      basicSalary: salary.value,
      status: status.value,
      lastWorkingDay: lastWorkingDay.value,
      unpaidLeaveDays: unpaidLeave.value,
    };
    accepted.set(id.value, validated);
    validRows.push(validated);
  }

  // --- Pass 3: manager cycles across the accepted set -----------------------
  // A single-row CHECK constraint refuses self-management, but A→B→A needs the
  // whole graph, which only exists here. Left unrejected, such a pair makes
  // §4.2's chain query depend on its depth cap for termination and puts two
  // people permanently in each other's downward visibility.
  for (const cycleRow of detectCycles(accepted)) {
    issues.push(
      issue(
        cycleRow.row,
        "managerOdooId",
        "manager_cycle",
        `Reporting line forms a loop: ${cycleRow.path.join(" → ")}. ` +
          `Break the loop so every chain ends at a top-level manager.`,
      ),
    );
  }

  const cycleRows = new Set(
    issues.filter((i) => i.rule === "manager_cycle").map((i) => i.rowNumber),
  );

  return { validRows: validRows.filter((r) => !cycleRows.has(r.rowNumber)), issues };
}

/**
 * Find rows whose manager chain loops back on itself, within the accepted set.
 *
 * Walks up from each row, bounded by the set size so a loop terminates on its
 * own even before it is recognised. Only rows the file itself introduces are
 * checked — an edge into an already-existing employee ends the walk, because
 * the file cannot change that employee's own manager unless it also carries
 * their row, in which case that row is in the set and gets walked too.
 */
function detectCycles(
  accepted: Map<string, ValidatedRow>,
): Array<{ row: ValidatedRow; path: string[] }> {
  const found: Array<{ row: ValidatedRow; path: string[] }> = [];

  for (const row of accepted.values()) {
    const path: string[] = [row.odooId];
    const seen = new Set<string>([row.odooId]);
    let current = row.managerOdooId;
    let steps = 0;

    while (current && steps <= accepted.size) {
      path.push(current);
      if (seen.has(current)) {
        found.push({ row, path });
        break;
      }
      seen.add(current);
      const next = accepted.get(current);
      if (!next) break; // Reaches an existing employee or an unknown id: no loop here.
      current = next.managerOdooId;
      steps += 1;
    }
  }

  return found;
}
