import { NextRequest } from "next/server";
import { z } from "zod";
import { prismaUnfiltered } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/api-helpers";
import { ok, notFound, err } from "@/lib/api-response";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import {
  RECYCLABLE_ENTITY_TYPES as ENTITY_TYPES,
  recyclableAccessor,
  type RecyclableDelegate,
  type RecyclableRecord,
} from "@/lib/prisma/recyclable";
import { recordAudit } from "@/lib/prisma/audit-extension";

const recyclable = prismaUnfiltered as unknown as Record<string, RecyclableDelegate>;

// Validate the restore body at the boundary (zod, like every other mutating
// route). entityType is still allowlist-checked below; this just turns a
// malformed/missing field into a clean 400 instead of an unhandled 500.
const restoreSchema = z.object({
  entityType: z.string().min(1),
  id: z.string().min(1),
});

// Caps for the in-memory merge/paginate. The bin spans multiple tables, so we
// can't push offset/limit into one query; we cap each type, merge, sort by
// recency, then cap the TOTAL and page in memory. PER_TYPE_CAP bounds each
// query; MERGE_CAP is the ceiling on the merged result so adding more recyclable
// models can't grow the reported total / working set without bound. The global
// sort runs before the total cap, so the 500 we keep are the 500 most-recently
// deleted across all types (not just whichever types iterated first). Generous
// for a prototype bin; a high-volume project should move retention/purge
// upstream (see /api/internal/audit-purge).
const PER_TYPE_CAP = 500;
const MERGE_CAP = 500;

// Admin-only: the bin lists soft-deleted records (incl. deleted-user PII + who
// deleted them); not exposed to VIEWER/EDITOR. The bin nav is also admin-gated.
export const GET = withAdminAuth(async (request: NextRequest) => {
  const pagination = parsePagination(request.nextUrl.searchParams);

  const merged: Array<{
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
      take: PER_TYPE_CAP,
    });

    for (const record of records) {
      const displayValue =
        (record[config.displayField] as string | undefined) ??
        (record.email as string | undefined) ??
        record.id;
      merged.push({
        entityType,
        id: record.id,
        displayName: displayValue,
        deletedAt: record.deletedAt as Date,
        deletedBy: record.deletedBy as string | null,
      });
    }
  }

  merged.sort(
    (a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime()
  );

  // Cap the merged total AFTER the global sort so the retained rows are the most
  // recently deleted across every type, then paginate within that ceiling.
  const capped = merged.slice(0, MERGE_CAP);
  const total = capped.length;
  const page = capped.slice(pagination.skip, pagination.skip + pagination.take);
  return ok(paginatedResponse(page, total, pagination));
});

// Restore is a state-changing, admin-grade action (re-activating a soft-deleted
// record -- including, e.g., a deactivated ADMIN account), so it is gated to
// ADMIN, matching the permanent-delete route. Listing the bin stays withAuth.
export const POST = withAdminAuth(async (request: NextRequest) => {
  const parsed = restoreSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }
  const { entityType, id } = parsed.data;

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

  // Don't echo the full unfiltered row -- it can carry Restricted fields like
  // passwordHash (SECURITY.md §1). The audit row above captured the change.
  return ok({ entityType, id, restored: true });
});
