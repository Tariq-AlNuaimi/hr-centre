import type { prisma } from "@/lib/prisma";
import type { EscalationEventKind } from "@/generated/prisma/enums";

/**
 * The one conditional-transition primitive the ticket state machine is built
 * on (docs/blueprints/hive-ticketing.md, phase T1). Its own module so the
 * anonymous reply path (`reply.ts`) can reopen a ticket without importing the
 * whole HR queue service and its mail transport.
 *
 * @public
 */

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type EscalationWhere = NonNullable<Parameters<Tx["escalation"]["update"]>[0]>["where"];
type EscalationData = NonNullable<Parameters<Tx["escalation"]["update"]>[0]>["data"];

/** Prisma's "record to update not found" — the row did not match the `where`. */
function isNoMatch(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && e.code === "P2025";
}

/**
 * Move ONE ticket only if it is still in the state the caller expects.
 *
 * `update` with the status in its `where`, not `updateMany`: the bulk form
 * skips the audit extension (`no-unaudited-bulk-write`), and every transition
 * here is a decision the audit trail must show. When the row no longer
 * matches, Prisma throws P2025 after a zero-row UPDATE — no SQL error, so the
 * transaction stays usable — and that is reported as "lost the race".
 */
export async function transition(
  tx: Tx,
  where: EscalationWhere,
  data: EscalationData,
): Promise<boolean> {
  try {
    await tx.escalation.update({ where, data, select: { id: true } });
    return true;
  } catch (e) {
    if (isNoMatch(e)) return false;
    throw e;
  }
}

/** A ticket's history line, written inside the transition's transaction. */
export async function recordEvent(
  tx: Tx,
  escalationId: string,
  kind: EscalationEventKind,
  actorId: string | null,
  note?: string,
) {
  await tx.escalationEvent.create({
    data: { escalationId, kind, actorId, note: note ?? null },
    select: { id: true },
  });
}
