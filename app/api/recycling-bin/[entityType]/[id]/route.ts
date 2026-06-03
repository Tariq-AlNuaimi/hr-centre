import { NextRequest } from "next/server";
import { prismaUnfiltered } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/api-helpers";
import { ok, err, notFound } from "@/lib/api-response";
import {
  recyclableAccessor,
  type RecyclableDelegate,
} from "@/lib/prisma/recyclable";
import { recordAudit } from "@/lib/prisma/audit-extension";

const recyclable = prismaUnfiltered as unknown as Record<string, RecyclableDelegate>;

export const DELETE = withAdminAuth(async (
  _request: NextRequest,
  { params }
) => {
  const { entityType, id } = await params;

  // Validate against the allowlist BEFORE indexing prismaUnfiltered -- the
  // entityType comes from the URL and would otherwise allow a hard delete on
  // any model (or an object-injection attempt).
  const accessor = recyclableAccessor(entityType);
  if (!accessor) return notFound(entityType);

  try {
    const record = await recyclable[accessor].findUnique({ where: { id } });

    if (!record) return notFound(entityType);

    await recyclable[accessor].delete({ where: { id } });

    // Permanent delete goes through prismaUnfiltered (outside the audit
    // extension); record the hard-delete explicitly so it is not a blind spot.
    await recordAudit(prismaUnfiltered, {
      entityType,
      entityId: id,
      action: "DELETE",
      before: record as unknown as Record<string, unknown>,
    });

    return ok({ deleted: true });
  } catch {
    return err(`Failed to delete ${entityType}`, 500);
  }
});
