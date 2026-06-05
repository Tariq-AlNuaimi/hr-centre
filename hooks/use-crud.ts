"use client";

import { useState, useCallback, useRef } from "react";
import type { PaginatedResponse } from "@/types";
import { apiClient } from "@/lib/api-client";

interface UseCrudOptions {
  basePath: string;
}

export function useCrud<T extends { id: string }>({
  basePath,
}: UseCrudOptions) {
  // Split loading per concern: `listLoading` drives the table spinner (reads),
  // `mutating` covers create/update/delete. A delete no longer blanks the whole
  // table behind the read spinner. `loading` is kept as the union for callers
  // that don't distinguish.
  const [listLoading, setListLoading] = useState(false);
  const [mutating, setMutating] = useState(false);

  // Tracks the in-flight `list` (read) request so a newer search/page keystroke
  // can abort the previous one. Without this, fast typing can land stale
  // responses out of order and overwrite fresher results. Mutations are not
  // aborted -- each must complete.
  const listAbortRef = useRef<AbortController | null>(null);

  // Internal dispatcher. Reads flow through apiClient with an abort signal so a
  // newer read supersedes the previous one; mutations carry a JSON body. The
  // returned hook shape is unchanged -- this only swaps the transport for the
  // typed `apiClient` (which parses the `ApiResponse<T>` envelope and throws an
  // `ApiError` carrying the server's message on non-2xx).
  const request = useCallback(
    async <R>(
      method: "GET" | "POST" | "PUT" | "DELETE",
      path: string,
      body?: unknown,
      kind: "read" | "mutate" = "read"
    ): Promise<R> => {
      const setBusy = kind === "read" ? setListLoading : setMutating;

      // For reads, abort the previous in-flight read before starting a new one.
      let signal: AbortSignal | undefined;
      if (kind === "read") {
        listAbortRef.current?.abort();
        const controller = new AbortController();
        listAbortRef.current = controller;
        signal = controller.signal;
      }

      // Errors propagate to the caller, which surfaces them via useNotify (the
      // template's single error path); callers ignore the AbortError thrown when
      // a newer read supersedes an in-flight one.
      setBusy(true);
      try {
        return await apiClient.request<R>(path, { method, body, signal });
      } finally {
        // Only clear the busy flag if this read is still the current one; an
        // aborted read's finally would otherwise prematurely stop the spinner
        // for the request that superseded it.
        if (kind !== "read" || signal?.aborted !== true) {
          setBusy(false);
        }
      }
    },
    []
  );

  const list = useCallback(
    (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return request<PaginatedResponse<T>>("GET", `${basePath}${qs}`);
    },
    [basePath, request]
  );

  const getById = useCallback(
    (id: string) => request<T>("GET", `${basePath}/${id}`),
    [basePath, request]
  );

  const create = useCallback(
    (data: Partial<T>) => request<T>("POST", basePath, data, "mutate"),
    [basePath, request]
  );

  const update = useCallback(
    (id: string, data: Partial<T>) =>
      request<T>("PUT", `${basePath}/${id}`, data, "mutate"),
    [basePath, request]
  );

  const remove = useCallback(
    (id: string) => request<T>("DELETE", `${basePath}/${id}`, undefined, "mutate"),
    [basePath, request]
  );

  return {
    list,
    getById,
    create,
    update,
    remove,
    listLoading,
    mutating,
    loading: listLoading || mutating,
  };
}
