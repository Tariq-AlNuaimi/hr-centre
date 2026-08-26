import { z } from "zod";

/** §12 — boundary validation for leavers, roll-ups and transfers. */

/**
 * A calendar date, as the ISO string the API speaks and a UTC midnight `Date`
 * downstream.
 *
 * UTC midnight, not local: §11.4 counts CALENDAR days, and a `Date` parsed in a
 * machine's local zone shifts the day for anyone east or west of it — which
 * moves a transfer across a period boundary and changes a score.
 */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .transform((s) => new Date(`${s}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), "not a real date");

/**
 * §12.1 — "Status = Leaver + last working day, settable by import or manually
 * (immediate one-off resignations)."
 *
 * Last working day is REQUIRED here, unlike in the import where a status change
 * without one is a row-level issue: this route is the deliberate manual act, and
 * §11.4 pro-rates the leaver's bonus "cycle start → last working day". Accepting
 * the departure without the date would produce a bonus computed to 31 December
 * for somebody who left in March.
 */
export const markLeaverSchema = z.object({
  employeeId: z.string().min(1),
  lastWorkingDay: calendarDate,
  /// Free text, optional. Recorded on the audit row rather than on the employee.
  note: z.string().trim().max(500).optional(),
});

/** §12.2 — HR names a permanent manager, closing the roll-up prompt. */
export const resolveRollUpSchema = z.object({
  rollUpId: z.string().min(1),
  /**
   * Null confirms the roll-up target AS the permanent manager — a real outcome
   * ("their new manager is the one they rolled up to"), distinct from leaving
   * the prompt open. Optional-and-nullable rather than absent, so the two cases
   * are told apart at the boundary instead of by a route guessing.
   */
  newManagerEmployeeId: z.string().min(1).nullable().optional(),
  resolutionNote: z.string().trim().max(500).optional(),
});

/**
 * §12.3 — a transfer splits the cycle in two at `transferDate`.
 *
 * The new department (and its manager) are named; the old ones are read from
 * where the employee sits NOW, because that is by definition the pre-transfer
 * position. Asking the caller for both invites a mismatch nobody would notice.
 */
export const recordTransferSchema = z.object({
  employeeId: z.string().min(1),
  cycleId: z.string().min(1),
  transferDate: calendarDate,
  /** Null for a move to a C-Level position (§1.2 — entity, no department). */
  newDepartmentId: z.string().min(1).nullable(),
  /** Required when the department is null, derived from it otherwise. */
  newEntityId: z.string().min(1).optional(),
  newManagerEmployeeId: z.string().min(1).nullable().optional(),
});
