import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, created, err } from "@/lib/api-response";
import { paginatedResponse } from "@/lib/pagination";
import { parseListQuery } from "@/lib/list-query";
import { createCustomFieldDefSchema } from "@/lib/validations/custom-field";
import type { Prisma } from "@/generated/prisma/client";

// Allowlist of sortable columns -- prevents raw column injection via ?sort=.
const SORTABLE_COLUMNS = ["label", "key", "type", "createdAt"] as const;

// Any authenticated user may READ the field definitions (the asset form renders them);
// only ADMIN may define them.
export const GET = withRateLimit(
  withAuth(async (request: NextRequest) => {
    const { pagination, where, orderBy } = parseListQuery<Prisma.CustomFieldDefWhereInput>(
      request.nextUrl.searchParams,
      { searchField: "label", sortable: SORTABLE_COLUMNS, defaultSort: "createdAt" },
    );

    const [data, total] = await Promise.all([
      prisma.customFieldDef.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy,
      }),
      prisma.customFieldDef.count({ where }),
    ]);

    return ok(paginatedResponse(data, total, pagination));
  }),
  { id: "custom-field-def-read", limit: 120, windowMs: 60000 },
);

export const POST = withRateLimit(
  withAdminAuth(async (request: NextRequest) => {
    const body = await request.json();
    const parsed = createCustomFieldDefSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "));
    }

    const existing = await prisma.customFieldDef.findUnique({ where: { key: parsed.data.key } });
    if (existing) return err("Custom field key already in use", 409);

    const def = await prisma.customFieldDef.create({ data: parsed.data });
    return created(def);
  }),
  { id: "custom-field-def-write", limit: 30, windowMs: 60000 },
);
