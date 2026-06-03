import { NextRequest } from "next/server";
import { prismaUnfiltered } from "@/lib/prisma";
import { withAuth, withAdminAuth } from "@/lib/api-helpers";
import { ok, notFound } from "@/lib/api-response";
import {
  RECYCLABLE_ENTITY_TYPES as ENTITY_TYPES,
  recyclableAccessor,
  type RecyclableDelegate,
  type RecyclableRecord,
} from "@/lib/prisma/recyclable";
import { recordAudit } from "@/lib/prisma/audit-extension";

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

// Restore is a state-changing, admin-grade action (re-activating a soft-deleted
// record -- including, e.g., a deactivated ADMIN account), so it is gated to
// ADMIN, matching the permanent-delete route. Listing the bin stays withAuth.
export const POST = withAdminAuth(async (request: NextRequest) => {
  const { entityType, id } = (await request.json()) as { entityType: string; id: string };

  const accessor = recyclableAccessor(entityType);
  if (!accessor) {
    return notFound(entityType);
  }

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

  // The restore goes through prismaUnfiltered (outside the audit extension),
  // so record the RESTORE row explicitly.
  await recordAudit(prismaUnfiltered, {
    entityType,
    entityId: id,
    action: "RESTORE",
    before: record as unknown as Record<string, unknown>,
    after: restored as unknown as Record<string, unknown>,
  });

  return ok(restored);
});
