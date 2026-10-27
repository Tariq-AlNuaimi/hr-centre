"use client";

import { useHiringQuery } from "../ui/api";

export type AiStatus = { configured: boolean; switchedOff: boolean };

/** Whether AI affordances are live. While loading they read as off (fail closed). */
export function useAiStatus() {
  const q = useHiringQuery<AiStatus>("/api/hiring/ai/status");
  const ready = Boolean(q.data?.configured && !q.data.switchedOff);
  return { ready, status: q.data ?? null, isLoading: q.isLoading };
}

export type InsightView = {
  id: string;
  kind: string;
  model: string | null;
  createdAt: string;
  text: string;
  json: Record<string, unknown> | null;
};
