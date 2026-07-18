import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withEditorAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, created, err } from "@/lib/api-response";
import { paginatedResponse } from "@/lib/pagination";
import { parseListQuery } from "@/lib/list-query";
import { createAssetModelSchema } from "@/lib/validations/asset-model";
import type { Prisma } from "@/generated/prisma/client";

// Allowlist of sortable columns -- prevents raw column injection via ?sort=.
const SORTABLE_COLUMNS = ["name", "createdAt"] as const;

export const GET = withRateLimit(
  withAuth(async (request: NextRequest) => {
    const { pagination, where, orderBy } = parseListQuery<Prisma.AssetModelWhereInput>(
      request.nextUrl.searchParams,
      { searchField: "name", sortable: SORTABLE_COLUMNS },
    );

    const [data, total] = await Promise.all([
      prisma.assetModel.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy,
        include: {
          category: { select: { id: true, name: true } },
          manufacturer: { select: { id: true, name: true } },
        },
      }),
      prisma.assetModel.count({ where }),
    ]);

    return ok(paginatedResponse(data, total, pagination));
  }),
  { id: "asset-model-read", limit: 120, windowMs: 60000 },
);

export const POST = withRateLimit(
  withEditorAuth(async (request: NextRequest) => {
    const body = await request.json();
    const parsed = createAssetModelSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "));
    }

    const assetModel = await prisma.assetModel.create({ data: parsed.data });

    return created(assetModel);
  }),
  { id: "asset-model-write", limit: 30, windowMs: 60000 },
);
