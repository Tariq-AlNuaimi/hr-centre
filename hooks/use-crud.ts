"use client";

import { useState, useCallback } from "react";
import type { PaginatedResponse } from "@/types";

interface UseCrudOptions {
  basePath: string;
}

export function useCrud<T extends { id: string }>({
  basePath,
}: UseCrudOptions) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(
    async <R>(
      path: string,
      options?: RequestInit
    ): Promise<R> => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(path, {
          headers: { "Content-Type": "application/json" },
          ...options,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Request failed");
        return json.data as R;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
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
      request<T>(basePath, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    [basePath, request]
  );

  const update = useCallback(
    (id: string, data: Partial<T>) =>
      request<T>(`${basePath}/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    [basePath, request]
  );

  const remove = useCallback(
    (id: string) =>
      request<T>(`${basePath}/${id}`, { method: "DELETE" }),
    [basePath, request]
  );

  return { list, getById, create, update, remove, loading, error };
}
