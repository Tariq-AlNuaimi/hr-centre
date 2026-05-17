import { NextRequest } from "next/server";
import { prismaUnfiltered } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/api-helpers";
import { ok, err, notFound } from "@/lib/api-response";

export const DELETE = withAdminAuth(async (
  _request: NextRequest,
  { params }
) => {
  const { entityType, id } = await params;
  const accessor = entityType[0].toLowerCase() + entityType.slice(1);

  try {
    const record = await (prismaUnfiltered as any)[accessor].findUnique({
      where: { id },
    });

    if (!record) return notFound(entityType);

    await (prismaUnfiltered as any)[accessor].delete({ where: { id } });

    return ok({ deleted: true });
  } catch {
    return err(`Failed to delete ${entityType}`, 500);
  }
});
