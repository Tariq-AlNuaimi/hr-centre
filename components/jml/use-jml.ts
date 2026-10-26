"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNotify } from "@/hooks/use-notify";
import { ApiError, apiClient } from "@/lib/api-client";

/**
 * The JML permissions the signed-in user holds anywhere — AFFORDANCES only;
 * every route re-checks in scope. Fails closed while loading.
 */
export function useJmlAccess() {
  const q = useQuery({
    queryKey: ["jml", "me"],
    queryFn: () => apiClient.get<{ permissions: string[]; userId: string }>("/api/jml/me"),
    staleTime: 60_000,
  });
  const held = new Set(q.data?.permissions ?? []);
  return {
    isLoading: q.isLoading,
    userId: q.data?.userId ?? null,
    can: (permission: string) => held.has(permission),
  };
}

export type Lookups = {
  companies: Array<{ id: string; code: string; name: string }>;
  directorates: Array<{ id: string; name: string; entityId: string }>;
  departments: Array<{ id: string; name: string; entityId: string; directorateId: string | null }>;
  teams: Array<{ id: string; name: string; departmentId: string }>;
  contractTypes: Array<{ id: string; name: string; code: string }>;
  employmentTypes: Array<{
    employmentType: string;
    active: boolean;
    defaultTemplateId: string | null;
    payrollApplicableDefault: boolean;
  }>;
  hrUsers: Array<{ id: string; name: string | null; email: string; supervises: boolean }>;
  classifications: Array<{ id: string; code: string; label: string }>;
  assetTypes: Array<{ id: string; label: string }>;
};

/** Read-only pickers every JML form shares (no admin route — Onboarding 8.4.2 / F7). */
export function useJmlLookups(enabled = true) {
  return useQuery({
    queryKey: ["jml", "lookups"],
    queryFn: () => apiClient.get<Lookups>("/api/jml/lookups"),
    staleTime: 60_000,
    enabled,
  });
}

/**
 * One JML write: run it, toast the outcome honestly (the server's refusal
 * sentence, never a green toast over a failure), refresh every JML query.
 */
export function useJmlAction(fallbackError: string) {
  const queryClient = useQueryClient();
  const { success, error } = useNotify();
  const [busy, setBusy] = useState(false);
  async function run<T>(action: () => Promise<T>, successMessage?: string): Promise<T | null> {
    setBusy(true);
    try {
      const result = await action();
      if (successMessage) success(successMessage);
      await queryClient.invalidateQueries({ queryKey: ["jml"] });
      return result;
    } catch (e) {
      error(e instanceof ApiError ? e.message : fallbackError);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy };
}
