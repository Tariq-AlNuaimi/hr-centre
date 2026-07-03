export interface PaginationParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function parsePagination(
  searchParams: URLSearchParams
): PaginationParams {
  const page = toPositiveInt(searchParams.get("page"), 1);
  const pageSize = Math.min(100, toPositiveInt(searchParams.get("pageSize"), 20));
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

// Coerce a raw query-param to a positive INTEGER, or fall back to a default.
// `Math.floor` drops fractional pages (`?page=1.5` -> 1) and `Number.isFinite`
// rejects non-finite coercions (`?page=Infinity`, `?pageSize=1e309`) that
// `Number(x) || d` lets through because Infinity is truthy. Anything < 1,
// NaN, or non-finite falls back to the default so skip/take stay integer and
// bounded (the Scalable pillar depends on this — it feeds Prisma skip/take).
function toPositiveInt(raw: string | null, fallback: number): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

export function paginatedResponse<T>(
  data: T[],
  total: number,
  params: PaginationParams
): PaginatedResponse<T> {
  return {
    data,
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.ceil(total / params.pageSize),
  };
}
