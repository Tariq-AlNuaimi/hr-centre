import { prisma } from "@/lib/prisma";

/**
 * An employee's change history (UX review R10, docs/blueprints/ux-p1-people.md
 * US-3): read from the audit log the record's writes already produce. Only
 * WHAT changed (field names), WHO and WHEN are returned — never a value, so a
 * salary or ID number edit is visible as an event without disclosing either
 * side of it, whatever the viewer's other permissions. Bounded to the newest
 * `take` rows. Bookkeeping columns are not "changes" a reader cares about.
 */

const NOISE = new Set(["updatedAt", "createdAt", "deletedAt", "deletedBy", "id"]);

export type HistoryEntry = {
  id: string;
  action: string;
  fields: string[];
  actor: string | null;
  at: Date;
};

export async function employeeHistory(employeeId: string, take = 50): Promise<HistoryEntry[]> {
  const rows = await prisma.auditLog.findMany({
    where: { entityType: "Employee", entityId: employeeId },
    orderBy: { timestamp: "desc" },
    take,
    select: {
      id: true,
      action: true,
      changes: true,
      actorEmail: true,
      timestamp: true,
      user: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    fields: changedFields(r.changes),
    actor: r.user?.name ?? r.actorEmail ?? null,
    at: r.timestamp,
  }));
}

/** The field names an audit `changes` object records, minus bookkeeping. Pure. */
export function changedFields(changes: unknown): string[] {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return [];
  return Object.keys(changes).filter((k) => !NOISE.has(k));
}
