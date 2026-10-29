import { readModuleSettings, writeModuleSetting } from "@/lib/core/settings/store";
import { DEFAULT_TICKET_PREFIX } from "@/lib/hive/ticket-id";
import {
  DEFAULT_RESPONSE_HOURS,
  statusLabelsSchema,
  type TicketSettingsInput,
} from "@/lib/validations/hive/ticket-settings";

/**
 * The ticket ID prefix and status labels (spec V2 §8.8 Settings, blueprint T5).
 *
 * Three keys on the core settings store (module "tickets", ADR-092). A missing
 * key means its default, so nothing has to be seeded and a read never fails on
 * a fresh database. Writes are audited by the store.
 *
 * @public
 */

const KEYS = ["ticketPrefix", "statusLabels", "responseHours"] as const;

export interface TicketSettings {
  ticketPrefix: string;
  /** Overrides only; a status not listed uses its built-in label. */
  statusLabels: Record<string, string>;
  /** Working hours to answer a new ticket (the internal answer-by target). */
  responseHours: number;
}

export async function getTicketSettings(): Promise<TicketSettings> {
  const row = await readModuleSettings("tickets", KEYS);
  const prefix = row.get("ticketPrefix");
  const hours = row.get("responseHours");
  // Re-validated on read: a hand-edited row must not put an unknown key or an
  // over-long label on every HR screen.
  const labels = statusLabelsSchema.safeParse(row.get("statusLabels") ?? {});
  return {
    ticketPrefix: typeof prefix === "string" && prefix ? prefix : DEFAULT_TICKET_PREFIX,
    statusLabels: labels.success ? labels.data : {},
    responseHours:
      typeof hours === "number" && Number.isInteger(hours) && hours > 0
        ? hours
        : DEFAULT_RESPONSE_HOURS,
  };
}

export async function updateTicketSettings(
  input: TicketSettingsInput,
  userId: string,
): Promise<TicketSettings> {
  for (const key of KEYS) {
    if (input[key] !== undefined) await writeModuleSetting("tickets", key, input[key], userId);
  }
  return getTicketSettings();
}
