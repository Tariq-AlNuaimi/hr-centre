"use client";

import { useHiringQuery } from "./api";

/** Requisitions the reader can see, for pickers and filters (first 100 by title). */
export function useRequisitionOptions(enabled = true) {
  const q = useHiringQuery<{
    data: { id: string; title: string; status: string; grade: string | null }[];
  }>(enabled ? "/api/hiring/requisitions?pageSize=100&sort=title&order=asc" : null);
  return { options: q.data?.data ?? [], isLoading: q.isLoading };
}
