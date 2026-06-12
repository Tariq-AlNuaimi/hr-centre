// Shared shape for polymorphic access to soft-deletable Prisma delegates.
// The recycling-bin routes index `prismaUnfiltered` by string at runtime;
// Prisma's per-model types can't express that without an explicit cast.
// Centralizing the shape here keeps the cast safer than `any`.

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
    where: { deletedAt: { not: null } };
    orderBy?: { deletedAt: "desc" };
    take?: number;
  }) => Promise<RecyclableRecord[]>;
  findUnique: (args: { where: { id: string } }) => Promise<RecyclableRecord | null>;
  update: (args: {
    where: { id: string };
    data: { deletedAt: null; deletedBy: null };
  }) => Promise<RecyclableRecord>;
  delete: (args: { where: { id: string } }) => Promise<RecyclableRecord>;
};
