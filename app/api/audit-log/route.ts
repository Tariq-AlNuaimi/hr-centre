import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prismaUnfiltered } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { parsePagination, paginatedResponse } from "@/lib/pagination";

// Validate the query filters at the boundary (zod parity with the mutating
// routes; VAPT-V05). Not an injection vector by itself -- Prisma parameterizes
// the values -- but it turns a malformed filter into a clean 400 and pins
// `action` to the known set instead of silently matching nothing.
const AUDIT_ACTIONS = ["CREATE", "UPDATE", "DELETE", "RESTORE"] as const;
const querySchema = z.object({
  entityType: z.string().min(1).max(100).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  userId: z.string().min(1).max(100).optional(),
});

// Explicit select for the list view (CP-PO1): drop the `before`/`after` JSON
// snapshots, which can be large and carry Confidential row data the list never
// renders. `changes` is kept -- the table shows its changed-field keys.
const LIST_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  action: true,
  changes: true,
  timestamp: true,
  user: { select: { id: true, name: true, email: true } },
  // The immutable label, returned ALONGSIDE the relation rather than instead of
  // it. `user` is null once that account is permanently deleted (onDelete:
  // SetNull), and before this column the row simply lost its actor. Rendering
  // falls back to `actorEmail` so a deleted actor still reads as attributed.
  actorEmail: true,
} satisfies Prisma.AuditLogSelect;

export const GET = withAdminAuth(async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const pagination = parsePagination(searchParams);

  const parsed = querySchema.safeParse({
    entityType: searchParams.get("entityType") ?? undefined,
    action: searchParams.get("action") ?? undefined,
    userId: searchParams.get("userId") ?? undefined,
  });
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const where: Prisma.AuditLogWhereInput = {};
  if (parsed.data.entityType) where.entityType = parsed.data.entityType;
  if (parsed.data.action) where.action = parsed.data.action;
  if (parsed.data.userId) where.userId = parsed.data.userId;

  const [data, total] = await Promise.all([
    prismaUnfiltered.auditLog.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { timestamp: "desc" },
      select: LIST_SELECT,
    }),
    prismaUnfiltered.auditLog.count({ where }),
  ]);

  return ok(paginatedResponse(data, total, pagination));
});
