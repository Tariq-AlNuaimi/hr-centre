"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { ExitView } from "./types";

export function useExit(caseId: string) {
  return useQuery({
    queryKey: ["jml", "exit", caseId],
    queryFn: () => apiClient.get<ExitView>(`/api/jml/leavers/${caseId}`),
  });
}
