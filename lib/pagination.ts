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
  // Upper-clamp BOTH axes so skip/take stay bounded integers fed to Prisma:
  // pageSize to 100, and page to MAX_PAGE so a finite-but-huge `?page=1e300`
  // (which passes toPositiveInt's floor+finite guard) can't produce a
  // ~1e302 skip that Postgres OFFSET rejects with a 500 — it degrades to an
  // empty last page instead. (The Scalable pillar depends on this.)
  const page = Math.min(MAX_PAGE, toPositiveInt(searchParams.get("page"), 1));
  const pageSize = Math.min(100, toPositiveInt(searchParams.get("pageSize"), 20));
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

// Page ceiling: far beyond any real dataset, small enough that page*pageSize
// stays a safe integer well within Postgres OFFSET range.
const MAX_PAGE = 1_000_000;

// Coerce a raw query-param to a positive INTEGER, or fall back to a default.
// `Math.floor` drops fractional pages (`?page=1.5` -> 1) and `Number.isFinite`
// rejects non-finite coercions (`?page=Infinity`, `?pageSize=1e309`) that
// `Number(x) || d` lets through because Infinity is truthy. Anything < 1, NaN,
// or non-finite falls back to the default; the caller applies the upper clamp.
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
