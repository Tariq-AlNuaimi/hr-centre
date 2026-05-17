import { NextRequest } from "next/server";
import { prismaUnfiltered } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { parsePagination, paginatedResponse } from "@/lib/pagination";

export const GET = withAdminAuth(async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const pagination = parsePagination(searchParams);

  const entityType = searchParams.get("entityType") ?? undefined;
  const action = searchParams.get("action") ?? undefined;
  const userId = searchParams.get("userId") ?? undefined;

  const where: Record<string, unknown> = {};
  if (entityType) where.entityType = entityType;
  if (action) where.action = action;
  if (userId) where.userId = userId;

  const [data, total] = await Promise.all([
    prismaUnfiltered.auditLog.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { timestamp: "desc" },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    prismaUnfiltered.auditLog.count({ where }),
  ]);

  return ok(paginatedResponse(data, total, pagination));
});
