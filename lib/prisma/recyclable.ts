// Shared shape for polymorphic access to soft-deletable Prisma delegates.
// The recycling-bin routes index `prismaUnfiltered` by string at runtime;
// Prisma's per-model types can't express that without an explicit cast.
// Centralizing the shape here keeps the cast safer than `any`.

import { recordAudit } from "./audit-extension";

export type RecyclableRecord = {
  id: string;
  deletedAt: Date | null;
  deletedBy: string | null;
  [key: string]: unknown;
};

// Single source of truth for which entity types participate in the recycling
// bin. BOTH the list/restore route AND the permanent-delete route validate
// against this -- never index prismaUnfiltered by an unvalidated URL segment.
// /scaffold-entity appends here in lockstep with registerSoftDeleteModel().
export const RECYCLABLE_ENTITY_TYPES: Record<string, { displayField: string }> = {
  User: { displayField: "name" },
  // PMS org data (ADR-065). Soft delete here is for ERRONEOUS records only — a
  // departure is `status = LEAVER` with a last working day (§12.1: "Record and
  // history are preserved… never deleted"), never a soft delete. The bin exists
  // so a mistaken row can be undone without breaking the §3.2 promise that an
  // Odoo employee ID never shifts.
  Employee: { displayField: "name" },
  Department: { displayField: "name" },
  OrgEntity: { displayField: "name" },
  Directorate: { displayField: "name" },
  Team: { displayField: "name" },
  AccessRole: { displayField: "name" },
  // HR tickets (HIVE port) reference data.
  HrTagPair: { displayField: "name" },
  HrTagMember: { displayField: "name" },
  HrTagCoverage: { displayField: "label" },
  RotationGroup: { displayField: "name" },
  RotationCoverage: { displayField: "label" },
  DiscountPartner: { displayField: "name" },
  NetworkProvider: { displayField: "name" },
  // Hiring (docs/blueprints/hiring.md).
  HiringRequisition: { displayField: "title" },
  HiringCandidate: { displayField: "name" },
  HiringInterview: { displayField: "location" },
  HiringScorecard: { displayField: "vote" },
  HiringQuestion: { displayField: "roleFamily" },
  HiringOffer: { displayField: "status" },
  HiringCompetency: { displayField: "name" },
  HiringGrade: { displayField: "name" },
  HiringJdTemplate: { displayField: "title" },
  HiringBulkJob: { displayField: "actionKind" },
  // JML S2 — a discarded DRAFT case only; archive is a status, never a delete.
  JmlCase: { displayField: "caseRef" },
  // Add more entity types here as you create them:
  // Project: { displayField: "name" },
};

/**
 * Returns the camelCase Prisma delegate accessor for a recyclable entity type,
 * or null if the type is not on the allowlist. Callers MUST treat null as 404.
 */
export function recyclableAccessor(entityType: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(RECYCLABLE_ENTITY_TYPES, entityType)) {
    return null;
  }
  return entityType[0].toLowerCase() + entityType.slice(1);
}

export type RecyclableDelegate = {
  findMany: (args: {
    // `lt` is optional so the recycling-bin GC (audit-purge cron) can select
    // rows soft-deleted before a retention cutoff; the bin's list/restore paths
    // pass `{ not: null }` alone.
    where: { deletedAt: { not: null; lt?: Date } };
    orderBy?: { deletedAt: "desc" };
    take?: number;
  }) => Promise<RecyclableRecord[]>;
  findUnique: (args: { where: { id: string } }) => Promise<RecyclableRecord | null>;
  update: (args: {
    where: { id: string };
    data: { deletedAt: null; deletedBy: null };
  }) => Promise<RecyclableRecord>;
  delete: (args: { where: { id: string } }) => Promise<RecyclableRecord>;
  count: (args: { where: { deletedAt: { not: null } } }) => Promise<number>;
};

// The raw client (`prismaUnfiltered`) typed for polymorphic delegate access.
// One place owns the `as unknown as` cast the comment above promises to
// centralize, so the recycling-bin routes, the audit-purge GC, and the
// dashboard stats widget stop re-deriving it.
export function recyclableClient(
  client: Parameters<typeof recordAudit>[0],
): Record<string, RecyclableDelegate> {
  return client as unknown as Record<string, RecyclableDelegate>;
}

/**
 * Permanently (hard) delete a soft-deleted record through the RAW client and
 * record the explicit DELETE audit row in the same step. The hard delete
 * bypasses the audit extension, so the audit write MUST accompany it -- this
 * helper is the single owner of that invariant, shared by the manual
 * permanent-delete route and the recycling-bin GC cron.
 */
export async function permanentlyDelete(
  client: Parameters<typeof recordAudit>[0],
  accessor: string,
  entityType: string,
  record: RecyclableRecord,
): Promise<void> {
  await recyclableClient(client)[accessor].delete({ where: { id: record.id } });
  await recordAudit(client, {
    entityType,
    entityId: record.id,
    action: "DELETE",
    before: record as unknown as Record<string, unknown>,
  });
}
