import { NextRequest } from "next/server";
import { prismaUnfiltered } from "@/lib/prisma";
import { withAuth } from "@/lib/api-helpers";
import { ok, notFound } from "@/lib/api-response";

// Register all soft-deletable entity types and their display field
const ENTITY_TYPES: Record<string, { displayField: string }> = {
  User: { displayField: "name" },
  // Add more entity types here as you create them:
  // Project: { displayField: "name" },
};

export const GET = withAuth(async () => {
  const results: Array<{
    entityType: string;
    id: string;
    displayName: string;
    deletedAt: Date;
    deletedBy: string | null;
  }> = [];

  for (const [entityType, config] of Object.entries(ENTITY_TYPES)) {
    const accessor = entityType[0].toLowerCase() + entityType.slice(1);
    const records = await (prismaUnfiltered as any)[accessor].findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      take: 100,
    });

    for (const record of records) {
      results.push({
        entityType,
        id: record.id,
        displayName:
          record[config.displayField] ?? record.email ?? record.id,
        deletedAt: record.deletedAt,
        deletedBy: record.deletedBy,
      });
    }
  }

  results.sort(
    (a, b) =>
      new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime()
  );

  return ok(results);
});

export const POST = withAuth(async (request: NextRequest) => {
  const { entityType, id } = await request.json();

  if (!ENTITY_TYPES[entityType]) {
    return notFound(entityType);
  }

  const accessor = entityType[0].toLowerCase() + entityType.slice(1);
  const record = await (prismaUnfiltered as any)[accessor].findUnique({
    where: { id },
  });

  if (!record || !record.deletedAt) {
    return notFound(entityType);
  }

  const restored = await (prismaUnfiltered as any)[accessor].update({
    where: { id },
    data: { deletedAt: null, deletedBy: null },
  });

  return ok(restored);
});
