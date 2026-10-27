"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { ageing } from "@/lib/hive/ticket-clock";
import { formatDateTime } from "@/lib/format";

const TONE = { ok: "success", soon: "warning", overdue: "danger" } as const;

/**
 * A ticket's internal clock (UX P1 tickets P1-2): green while on time, amber
 * within 4 hours of its answer-by time, red once past it; nothing once the
 * answer is sent or the ticket closed. HR-only — never shown to employees.
 */
export function AgeingBadge({ dueAt, status }: { dueAt: string | null; status: string }) {
  const t = useTranslations("hive.escalations.ageing");
  const state = ageing(dueAt, status as Parameters<typeof ageing>[1]);
  if (state === "none") return null;
  return (
    <Badge variant={TONE[state]} title={dueAt ? formatDateTime(dueAt) : undefined}>
      {t(state, { at: dueAt ? formatDateTime(dueAt) : "" })}
    </Badge>
  );
}
