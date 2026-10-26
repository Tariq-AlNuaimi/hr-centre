/**
 * Spec V2 §8.6: "The ticket ID format is HIVE- followed by a four-digit running
 * number (HIVE-0001). Numbers never repeat."
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
export const DEFAULT_TICKET_PREFIX = "HIVE";

export function formatTicketId(
  ticketNumber: number,
  prefix: string = DEFAULT_TICKET_PREFIX,
): string {
  return `${prefix}-${String(ticketNumber).padStart(4, "0")}`;
}
