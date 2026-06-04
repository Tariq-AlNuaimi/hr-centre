"use client";

import { useState, useCallback, useRef } from "react";
import type { PaginatedResponse } from "@/types";

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
  const [error, setError] = useState<string | null>(null);

  // Tracks the in-flight `list` (read) request so a newer search/page keystroke
  // can abort the previous one. Without this, fast typing can land stale
  // responses out of order and overwrite fresher results. Mutations are not
  // aborted -- each must complete.
  const listAbortRef = useRef<AbortController | null>(null);

  const request = useCallback(
    async <R>(
      path: string,
      options?: RequestInit,
      kind: "read" | "mutate" = "read"
    ): Promise<R> => {
      const setBusy = kind === "read" ? setListLoading : setMutating;

      // For reads, abort the previous in-flight read before starting a new one.
      let signal: AbortSignal | undefined = options?.signal ?? undefined;
      if (kind === "read") {
        listAbortRef.current?.abort();
        const controller = new AbortController();
        listAbortRef.current = controller;
        signal = controller.signal;
      }

      setBusy(true);
      setError(null);
      try {
        const res = await fetch(path, {
          headers: { "Content-Type": "application/json" },
          ...options,
          signal,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Request failed");
        return json.data as R;
      } catch (err) {
        // A superseded read was intentionally aborted -- swallow it so the
        // caller's catch doesn't surface a spurious error for the stale request.
        if (err instanceof DOMException && err.name === "AbortError") {
          throw err;
        }
        const msg = err instanceof Error ? err.message : "Unknown error";
        setError(msg);
        throw err;
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
      return request<PaginatedResponse<T>>(`${basePath}${qs}`);
    },
    [basePath, request]
  );

  const getById = useCallback(
    (id: string) => request<T>(`${basePath}/${id}`),
    [basePath, request]
  );

  const create = useCallback(
    (data: Partial<T>) =>
      request<T>(
        basePath,
        {
          method: "POST",
          body: JSON.stringify(data),
        },
        "mutate"
      ),
    [basePath, request]
  );

  const update = useCallback(
    (id: string, data: Partial<T>) =>
      request<T>(
        `${basePath}/${id}`,
        {
          method: "PUT",
          body: JSON.stringify(data),
        },
        "mutate"
      ),
    [basePath, request]
  );

  const remove = useCallback(
    (id: string) =>
      request<T>(`${basePath}/${id}`, { method: "DELETE" }, "mutate"),
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
    error,
  };
}
