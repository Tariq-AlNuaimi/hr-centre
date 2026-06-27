import { NextRequest } from "next/server";
import { prismaUnfiltered } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/api-helpers";
import { ok, err, notFound } from "@/lib/api-response";
import {
  recyclableAccessor,
  recyclableClient,
  permanentlyDelete,
  type RecyclableRecord,
} from "@/lib/prisma/recyclable";

const recyclable = recyclableClient(prismaUnfiltered);

export const DELETE = withAdminAuth(async (
  _request: NextRequest,
  { params, session }
) => {
  const { entityType, id } = await params;

  // Validate against the allowlist BEFORE indexing prismaUnfiltered -- the
  // entityType comes from the URL and would otherwise allow a hard delete on
  // any model (or an object-injection attempt).
  const accessor = recyclableAccessor(entityType);
  if (!accessor) return notFound(entityType);

  try {
    const record = (await recyclable[accessor].findUnique({
      where: { id },
    })) as RecyclableRecord | null;

    if (!record) return notFound(entityType);
    // Tenant-scope: an admin can only permanently delete their own org's records
    // (the id lookup is global; a cross-org id is treated as not-found).
    if (record.orgId !== session.user.orgId) return notFound(entityType);

    // Hard-delete + explicit DELETE audit row in one step (the helper owns the
    // "permanent delete bypasses the extension, so it must be audited" rule).
    await permanentlyDelete(prismaUnfiltered, accessor, entityType, record);

    return ok({ deleted: true });
  } catch {
    return err(`Failed to delete ${entityType}`, 500);
  }
});
