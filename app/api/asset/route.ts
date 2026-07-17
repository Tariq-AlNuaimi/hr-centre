import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withEditorAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, created, err } from "@/lib/api-response";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { createAssetSchema } from "@/lib/validations/asset";

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
    const where = search ? { assetTag: { contains: search, mode: "insensitive" as const } } : {};

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

    const asset = await prisma.asset.create({ data: parsed.data });

    return created(asset);
  }),
  { id: "asset-write", limit: 30, windowMs: 60000 },
);
