"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { PaginatedResponse } from "@/types";

// Declarative client data layer over the typed `apiClient` (ADR-021). Replaces
// the imperative useCrud + useEffect + manual-setState pattern with TanStack
// Query: caching, request dedup/cancellation, keep-previous-data pagination, and
// automatic cache invalidation after writes -- the same UI behavior with far
// less per-page wiring.
//
// Server components still hit Prisma directly; these hooks are for the client
// CRUD pages the scaffolder generates.

// Query-key factory for a REST entity rooted at `basePath` (e.g. "/api/users").
// Centralizing the keys lets a mutation invalidate exactly the right cache
// entries instead of every call site re-deriving the shape.
export function entityKeys(basePath: string) {
  return {
    all: [basePath] as const,
    lists: () => [basePath, "list"] as const,
    list: (params: Record<string, string>) =>
      [basePath, "list", params] as const,
    details: () => [basePath, "detail"] as const,
    detail: (id: string) => [basePath, "detail", id] as const,
  };
}

/**
 * Paginated list query. `placeholderData: keepPreviousData` keeps the current
 * page rendered while the next page/search/sort loads, so the table never
 * blanks -- the behavior the old useCrud abort-dedup hand-rolled, now for free.
 * `params` should be the already-stringified query params (page, pageSize,
 * search, sort, order, filters); it doubles as part of the cache key.
 *
 * `errorMessage` (translated by the caller) is attached as query `meta` so the
 * QueryProvider's cache-level onError can toast it once per real failure --
 * never on a mount that replays a cached error (ADR-021).
 */
export function useEntityList<T>(
  basePath: string,
  params: Record<string, string>,
  errorMessage?: string
) {
  const keys = entityKeys(basePath);
  return useQuery({
    queryKey: keys.list(params),
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams(params).toString();
      return apiClient.get<PaginatedResponse<T>>(
        qs ? `${basePath}?${qs}` : basePath,
        { signal }
      );
    },
    placeholderData: keepPreviousData,
    meta: errorMessage ? { errorMessage } : undefined,
  });
}

/**
 * Single-record query, disabled until an `id` is present (so a detail page can
 * call it before the route param resolves without firing a bad request).
 * `errorMessage` surfaces via the cache-level onError, as in useEntityList.
 */
export function useEntityItem<T>(
  basePath: string,
  id: string | undefined,
  errorMessage?: string
) {
  const keys = entityKeys(basePath);
  return useQuery({
    queryKey: keys.detail(id ?? ""),
    queryFn: ({ signal }) =>
      apiClient.get<T>(`${basePath}/${id}`, { signal }),
    enabled: Boolean(id),
    meta: errorMessage ? { errorMessage } : undefined,
  });
}

/**
 * Create / update / delete mutations for an entity. Each invalidates the
 * entity's cached lists (and the affected detail) on success, so every mounted
 * list refetches automatically -- no manual re-fetch plumbing in the page.
 * Callers use `mutateAsync` to await + catch, and `isPending` for button state.
 */
export function useEntityMutations<T extends { id: string }>(basePath: string) {
  const queryClient = useQueryClient();
  const keys = entityKeys(basePath);

  // Invalidate everything under the entity root (`keys.all` is the prefix of
  // both lists() and detail()), so a write refreshes the lists AND every cached
  // detail in one call -- including sibling details a per-id invalidation would
  // miss (e.g. a relation edit that changes another record's rendered name).
  // TanStack only refetches the queries that are currently mounted; the rest are
  // just marked stale, so this is correct, not wasteful.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: keys.all });
  };

  const create = useMutation({
    mutationFn: (data: Partial<T>) => apiClient.post<T>(basePath, data),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<T> }) =>
      apiClient.put<T>(`${basePath}/${id}`, data),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete<T>(`${basePath}/${id}`),
    onSuccess: invalidate,
  });

  return { create, update, remove };
}
