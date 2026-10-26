import { z } from "zod";

/**
 * Spec V2 §8.8 Settings (blueprint T5): the ticket ID prefix and the status
 * labels HR see.
 *
 * @public
 */

/** The statuses whose label may be renamed. No new statuses (Amendment B-6). */
export const LABELLED_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "PENDING_APPROVAL",
  "APPROVED",
  "SEND_FAILED",
  "SENT",
  "CLOSED",
] as const;

/**
 * 2–10 characters, A–Z/0–9, starting with a letter, stored uppercase. No hyphen
 * or space, so `<prefix>-<number>` always parses back unambiguously.
 */
export const ticketPrefixSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(
    z
      .string()
      .regex(
        /^[A-Z][A-Z0-9]{1,9}$/,
        "Use 2–10 letters or digits, starting with a letter (for example HIVE or HR).",
      ),
  );

const labelSchema = z.string().trim().max(30, "Keep a label to 30 characters.");

/**
 * Labels as submitted: every key optional, and a blank value means "use the
 * built-in label" — it is dropped rather than stored, so a status never renders
 * empty.
 */
export const statusLabelsSchema = z
  .object(Object.fromEntries(LABELLED_STATUSES.map((s) => [s, labelSchema.optional()])))
  .strict()
  .transform((labels) =>
    Object.fromEntries(Object.entries(labels).filter((e): e is [string, string] => Boolean(e[1]))),
  );

export const ticketSettingsSchema = z.object({
  ticketPrefix: ticketPrefixSchema,
  statusLabels: statusLabelsSchema,
});

export type TicketSettingsInput = z.output<typeof ticketSettingsSchema>;
