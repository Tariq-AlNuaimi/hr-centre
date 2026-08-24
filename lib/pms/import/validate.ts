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
/**
 * Email uniqueness — §3.4, batch level.
 *
 * `Employee.email` is `@unique`, so a collision is not a style problem: the
 * write fails. And because apply runs the whole batch in ONE transaction, an
 * uncaught collision rolls back every other create and update in the file —
 * after a preview that reported no rejections. Catching it here turns that into
 * an ordinary, row-scoped rejection carrying a reason, which is what §3.4 asks
 * for ("a row failing any rule is rejected/flagged, never silently accepted").
 *
 * Lives here rather than in `checks/identity.ts` for two reasons: the in-file
 * duplicate rule needs every other row, and the in-use rule consults the
 * database — and identity.ts's checks are deliberately all pure.
 */
function checkEmailUniqueness(
  row: EmployeeSourceRow,
  email: string,
  odooId: string,
  ctx: {
    duplicateEmails: Set<string>;
    emailCounts: Map<string, number[]>;
    emailOwners: Map<string, string>;
  },
): ImportIssue[] {
  if (!email) return [];

  if (ctx.duplicateEmails.has(email)) {
    const where = (ctx.emailCounts.get(email) ?? []).join(", ");
    return [
      issue(
        row,
        "email",
        "email_duplicate",
        `Email "${email}" appears on more than one row (rows ${where}). ` +
          `Each employee needs their own address.`,
      ),
    ];
  }

  // Only meaningful once this row has an ID of its own: a row whose ID is blank
  // is already rejected, and a "belongs to someone else" clash reported against
  // an empty ID would be noise.
  const owner = ctx.emailOwners.get(email);
  if (!odooId || !owner || owner === odooId) return [];

  return [
    issue(
      row,
      "email",
      "email_in_use",
      `Email "${email}" already belongs to employee ${owner}. ` +
        `Give this person their own address, or correct the Employee ID ` +
        `if this is the same person.`,
    ),
  ];
}

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

  // Email uniqueness, same batch-level shape as the ID rule above and here for
  // the same reason: it cannot be answered a row at a time. `Employee.email` is
  // `@unique`, so a collision is not a style problem — the write fails. Because
  // apply runs the whole batch in ONE transaction, an uncaught collision rolls
  // back every other create and update in the file, after a preview that
  // reported no rejections. Catching it here turns that into an ordinary,
  // row-scoped rejection with a reason, which is what §3.4 asks for.
  const emailCounts = new Map<string, number[]>();
  for (const row of rows) {
    const email = row.email?.trim().toLowerCase() ?? "";
    if (!email) continue;
    const seen = emailCounts.get(email);
    if (seen) seen.push(row.rowNumber);
    else emailCounts.set(email, [row.rowNumber]);
  }
  const duplicateEmails = new Set(
    [...emailCounts.entries()].filter(([, rowNumbers]) => rowNumbers.length > 1).map(([e]) => e),
  );

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

    const emailIssues = checkEmailUniqueness(row, identity.value.email, id.value, {
      duplicateEmails,
      emailCounts,
      emailOwners: ctx.emailOwners,
    });

    const rowIssues = [
      ...id.issues,
      ...identity.issues,
      ...emailIssues,
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
