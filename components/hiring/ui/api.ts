"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * The hiring client data layer: typed fetch that KEEPS the server's refusal
 * code (the stage-gate dialogs branch on GATE_CONFIRM_REQUIRED etc.), plus thin
 * TanStack wrappers. Every write invalidates the whole `hiring` cache — hiring
 * screens show overlapping facts (a stage move changes the board, the profile,
 * the requisition fill), and a stale number there is a wrong decision.
 */

export class HiringApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "HiringApiError";
  }
}

export async function hiringFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const envelope = (await res.json().catch(() => null)) as {
    data?: T;
    error?: string;
    code?: string;
  } | null;
  if (!res.ok)
    throw new HiringApiError(envelope?.error ?? "Request failed", res.status, envelope?.code);
  return envelope?.data as T;
}

export function useHiringQuery<T>(path: string | null) {
  return useQuery({
    queryKey: ["hiring", path],
    queryFn: () => hiringFetch<T>(path!),
    enabled: Boolean(path),
    retry: (count, e) => !(e instanceof HiringApiError && e.status < 500) && count < 2,
  });
}

export function useHiringMutation<TBody = unknown, TResult = unknown>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string | ((body: TBody) => string),
  opts: { success?: string; onSuccess?: (r: TResult) => void; silentCodes?: string[] } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) =>
      hiringFetch<TResult>(typeof path === "function" ? path(body) : path, {
        method,
        body: method === "DELETE" && body === undefined ? undefined : body,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["hiring"] });
      if (opts.success) toast.success(opts.success);
      opts.onSuccess?.(r);
    },
    onError: (e) => {
      if (e instanceof HiringApiError && e.code && opts.silentCodes?.includes(e.code)) return;
      toast.error(e.message);
    },
  });
}

export type HiringMe = { userId: string; isAdmin: boolean; permissions: string[] };

/** Affordances only (fail closed while loading); every route re-checks in scope. */
export function useHiringMe() {
  const q = useHiringQuery<HiringMe>("/api/hiring/me");
  const perms = new Set(q.data?.permissions ?? []);
  return {
    me: q.data ?? null,
    isLoading: q.isLoading,
    has: (permission: string) => perms.has(permission),
  };
}

export function qs(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== null && v !== undefined && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Multipart upload with the same error envelope as `hiringFetch`. */
export async function hiringUpload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { method: "POST", body: form });
  const envelope = (await res.json().catch(() => null)) as {
    data?: T;
    error?: string;
    code?: string;
  } | null;
  if (!res.ok)
    throw new HiringApiError(envelope?.error ?? "Request failed", res.status, envelope?.code);
  return envelope?.data as T;
}
