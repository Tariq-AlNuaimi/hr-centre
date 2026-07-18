import { parsePagination } from "@/lib/pagination";

/**
 * Parse the shared list-route query shape — pagination + a `?search=` case-insensitive
 * `contains` filter on one field + an allowlisted `?sort=`/`?order=` — into the pieces a
 * Prisma `findMany`/`count` pair needs. The sort field is checked against `sortable` so a
 * raw `?sort=` can't inject an arbitrary column (the same guard every route open-coded).
 *
 * `where` is returned as the caller-supplied `Prisma.<Model>WhereInput` generic so routes
 * stay fully type-safe; pass it as `parseListQuery<Prisma.CategoryWhereInput>(...)`.
 */
export function parseListQuery<TWhere extends object = Record<string, unknown>>(
  searchParams: URLSearchParams,
  opts: { searchField: string; sortable: readonly string[]; defaultSort?: string },
): {
  pagination: ReturnType<typeof parsePagination>;
  where: TWhere;
  orderBy: Record<string, "asc" | "desc">;
} {
  const pagination = parsePagination(searchParams);
  const search = searchParams.get("search") ?? undefined;
  const where = (
    search ? { [opts.searchField]: { contains: search, mode: "insensitive" } } : {}
  ) as TWhere;

  const sortParam = searchParams.get("sort");
  const sortField =
    sortParam && opts.sortable.includes(sortParam) ? sortParam : (opts.defaultSort ?? "createdAt");
  const order: "asc" | "desc" = searchParams.get("order") === "asc" ? "asc" : "desc";

  return { pagination, where, orderBy: { [sortField]: order } };
}
