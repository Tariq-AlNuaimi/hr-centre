/**
 * Spec V2 §8.6: a prefix followed by a four-digit running number. Numbers never
 * repeat. The default prefix was HIVE until UX P1 renamed the module "HR
 * tickets" (HR-0001); old HIVE-0001 ids stay searchable (any prefix is accepted
 * by the queue search).
 *
 * The number comes from the database sequence (`Escalation.ticketNumber`); this
 * only renders it. Beyond 9999 the number simply grows a digit — it never wraps,
 * because a wrapped number would repeat one an employee already holds.
 *
 * The prefix becomes admin-editable in phase T5 (spec §8.8 Settings); until then
 * it is this constant, passed explicitly so the call sites do not change later.
 *
 * @public
 */
export const DEFAULT_TICKET_PREFIX = "HR";

export function formatTicketId(
  ticketNumber: number,
  prefix: string = DEFAULT_TICKET_PREFIX,
): string {
  return `${prefix}-${String(ticketNumber).padStart(4, "0")}`;
}
