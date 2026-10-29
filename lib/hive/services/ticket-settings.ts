import { prisma } from "@/lib/prisma";
import { DEFAULT_TICKET_PREFIX } from "@/lib/hive/ticket-id";
import {
  DEFAULT_RESPONSE_HOURS,
  statusLabelsSchema,
  type TicketSettingsInput,
} from "@/lib/validations/hive/ticket-settings";

/**
 * The ticket ID prefix and status labels (spec V2 §8.8 Settings, blueprint T5).
 *
 * One row with a fixed id. A missing row means the defaults, so nothing has to
 * be seeded and a read never fails on a fresh database. Writes go through the
 * normal client, so the audit extension records who changed what.
 *
 * @public
 */

const ID = "singleton";

export interface TicketSettings {
  ticketPrefix: string;
  /** Overrides only; a status not listed uses its built-in label. */
  statusLabels: Record<string, string>;
  /** Working hours to answer a new ticket (the internal answer-by target). */
  responseHours: number;
}

export async function getTicketSettings(): Promise<TicketSettings> {
  const row = await prisma.hiveTicketSettings.findUnique({
    where: { id: ID },
    select: { ticketPrefix: true, statusLabels: true, responseHours: true },
  });
  if (!row) {
    return {
      ticketPrefix: DEFAULT_TICKET_PREFIX,
      statusLabels: {},
      responseHours: DEFAULT_RESPONSE_HOURS,
    };
  }
  // Re-validated on read: a hand-edited row must not put an unknown key or an
  // over-long label on every HR screen.
  const labels = statusLabelsSchema.safeParse(row.statusLabels);
  return {
    ticketPrefix: row.ticketPrefix,
    statusLabels: labels.success ? labels.data : {},
    responseHours: row.responseHours ?? DEFAULT_RESPONSE_HOURS,
  };
}

export async function updateTicketSettings(
  input: TicketSettingsInput,
  userId: string,
): Promise<TicketSettings> {
  const data = { ...input, updatedById: userId };
  const select = { ticketPrefix: true, statusLabels: true, responseHours: true } as const;
  // create-or-update rather than `upsert`: upsert bypasses the audit extension
  // (ADR-010). Two editors racing the very first save is the only window where
  // the create can collide, and the loser's P2002 simply retries as an update.
  const exists = await prisma.hiveTicketSettings.findUnique({
    where: { id: ID },
    select: { id: true },
  });
  let row;
  try {
    row = exists
      ? await prisma.hiveTicketSettings.update({ where: { id: ID }, data, select })
      : await prisma.hiveTicketSettings.create({ data: { id: ID, ...data }, select });
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e;
    row = await prisma.hiveTicketSettings.update({ where: { id: ID }, data, select });
  }
  return {
    ticketPrefix: row.ticketPrefix,
    statusLabels: row.statusLabels as Record<string, string>,
    responseHours: row.responseHours,
  };
}
