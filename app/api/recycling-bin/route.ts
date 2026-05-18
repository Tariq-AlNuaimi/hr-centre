import { NextRequest } from "next/server";
import { prismaUnfiltered } from "@/lib/prisma";
import { withAuth } from "@/lib/api-helpers";
import { ok, notFound } from "@/lib/api-response";
import type { RecyclableDelegate, RecyclableRecord } from "@/lib/prisma/recyclable";

// Register all soft-deletable entity types and their display field
const ENTITY_TYPES: Record<string, { displayField: string }> = {
  User: { displayField: "name" },
  // Add more entity types here as you create them:
  // Project: { displayField: "name" },
};

const recyclable = prismaUnfiltered as unknown as Record<string, RecyclableDelegate>;

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
    const records = await recyclable[accessor].findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      take: 100,
    });

    for (const record of records) {
      const displayValue =
        (record[config.displayField] as string | undefined) ??
        (record.email as string | undefined) ??
        record.id;
      results.push({
        entityType,
        id: record.id,
        displayName: displayValue,
        deletedAt: record.deletedAt as Date,
        deletedBy: record.deletedBy as string | null,
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
  const { entityType, id } = (await request.json()) as { entityType: string; id: string };

  if (!ENTITY_TYPES[entityType]) {
    return notFound(entityType);
  }

  const accessor = entityType[0].toLowerCase() + entityType.slice(1);
  const record = (await recyclable[accessor].findUnique({
    where: { id },
  })) as RecyclableRecord | null;

  if (!record || !record.deletedAt) {
    return notFound(entityType);
  }

  const restored = await recyclable[accessor].update({
    where: { id },
    data: { deletedAt: null, deletedBy: null },
  });

  return ok(restored);
});
