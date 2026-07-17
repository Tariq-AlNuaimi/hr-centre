import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withEditorAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, created, err } from "@/lib/api-response";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { createAssetSchema } from "@/lib/validations/asset";
import { AssetStatus, AssetCategory } from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";

// Allowlist of sortable columns -- prevents raw column injection via ?sort=.
const SORTABLE_COLUMNS = [
  "assetTag",
  "name",
  "serial",
  "purchasedAt",
  "status",
  "category",
  "createdAt",
] as const;
type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

export const GET = withRateLimit(
  withAuth(async (request: NextRequest) => {
    const { searchParams } = request.nextUrl;
    const pagination = parsePagination(searchParams);

    const search = searchParams.get("search") ?? undefined;
    const where: Prisma.AssetWhereInput = {};
    if (search) where.assetTag = { contains: search, mode: "insensitive" };
    // Server-side status/category filters (wired to the DataTable column filters).
    const statusParam = searchParams.get("status");
    if (statusParam && statusParam in AssetStatus) where.status = statusParam as AssetStatus;
    const categoryParam = searchParams.get("category");
    if (categoryParam && categoryParam in AssetCategory)
      where.category = categoryParam as AssetCategory;

    const sortParam = searchParams.get("sort");
    const sortField: SortableColumn =
      sortParam && (SORTABLE_COLUMNS as readonly string[]).includes(sortParam)
        ? (sortParam as SortableColumn)
        : "createdAt";
    const order: "asc" | "desc" = searchParams.get("order") === "asc" ? "asc" : "desc";

    const [data, total] = await Promise.all([
      prisma.asset.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { [sortField]: order },
        include: {
          assignee: { select: { id: true, name: true } },
        },
      }),
      prisma.asset.count({ where }),
    ]);

    return ok(paginatedResponse(data, total, pagination));
  }),
  { id: "asset-read", limit: 120, windowMs: 60000 },
);

export const POST = withRateLimit(
  withEditorAuth(async (request: NextRequest) => {
    const body = await request.json();
    const parsed = createAssetSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "));
    }

    // assetTag is @unique + immutable — surface a duplicate as a clean 409, not a raw P2002 500
    // (mirrors app/api/users/route.ts's email pre-check).
    const existing = await prisma.asset.findUnique({
      where: { assetTag: parsed.data.assetTag },
    });
    if (existing) return err("Asset tag already in use", 409);

    const asset = await prisma.asset.create({ data: parsed.data });

    return created(asset);
  }),
  { id: "asset-write", limit: 30, windowMs: 60000 },
);
