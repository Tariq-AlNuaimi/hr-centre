"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { PerformanceCycle } from "@/components/pms/CycleList";

/**
 * "Which cycle am I looking at" — extracted because six Phase 4-6 screens ask it
 * and all six must answer it the same way.
 *
 * The default is the OPEN cycle, falling back to the most recent year. That
 * matters: §2 runs one cycle at a time, so an operator opening a report almost
 * always means the live one — but during the January gap between a closed 2027
 * and an unopened 2028 there IS no open cycle, and defaulting to nothing would
 * show an empty screen that looks broken rather than last year's results.
 *
 * Every screen keeps its own selection state; nothing is persisted. A cycle
 * chosen on the reports page should not silently change what the calibration
 * page opens on.
 */
export function useCycleSelection(enabled = true) {
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);

  const cycles = useQuery({
    queryKey: ["pms", "cycles"],
    queryFn: () => apiClient.get<PerformanceCycle[]>("/api/cycles"),
    enabled,
  });

  const cycleList = cycles.data ?? [];
  const mostRecent = [...cycleList].sort((a, b) => b.year - a.year)[0] ?? null;
  const fallback = cycleList.find((c) => c.status === "OPEN") ?? mostRecent;
  const selected = cycleList.find((c) => c.id === selectedCycleId) ?? fallback;

  return {
    cycles,
    cycleList,
    selected,
    cycleId: selected?.id ?? null,
    selectedCycleId,
    setSelectedCycleId,
  };
}
