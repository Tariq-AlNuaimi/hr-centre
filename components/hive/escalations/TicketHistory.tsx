"use client";

import { SectionCard } from "@/components/shared/SectionCard";
import { useEventLabels } from "@/components/hive/escalations/status-labels";

import type { Detail } from "./TicketActions";

/** A ticket's history (spec V2 §8.8). */
export function HistoryCard({
  events,
  when,
  t,
}: {
  events: Detail["events"];
  when: (iso: string) => string;
  t: (key: string, values?: Record<string, string>) => string;
}) {
  const label = useEventLabels();
  return (
    <SectionCard title={t("history")}>
      {events.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">{t("historyEmpty")}</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {events.map((e) => (
            <li key={e.id} className="flex flex-col gap-0.5">
              <span className="text-sm text-foreground">
                {label[e.kind] ?? e.kind} · {e.actor?.name ?? t("system")}
              </span>
              <span className="text-xs text-muted-foreground">{when(e.at)}</span>
              {e.note && (
                <p className="m-0 whitespace-pre-line text-sm text-muted-foreground">{e.note}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}
