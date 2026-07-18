import * as React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export type AgentActivityItem = {
  /** Short timestamp label, e.g. "10:24" (caller formats + localizes). */
  time: string;
  /** The event description — pass a node so callers can bold entities/localize. */
  text: React.ReactNode;
  /** Who acted: an AI agent or a human. Drives the trailing tag. */
  actor: "ai" | "human";
};

/**
 * AgentActivity — an immutable, audited feed distinguishing AI actions from human
 * ones (MIGRATION.md). Each row: mono time · event · an AI/Human tag. Header and
 * the AI/Human labels come from props (localized by the caller); English defaults
 * render via expressions. Presentational — the audit trail itself is server-side.
 */
export function AgentActivity({
  items,
  title = "Agent activity",
  meta = "immutable · audited",
  aiLabel = "AI",
  humanLabel = "Human",
  className,
}: {
  items: AgentActivityItem[];
  title?: string;
  meta?: string;
  aiLabel?: string;
  humanLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="ms-auto text-xs text-muted-foreground">{meta}</span>
      </div>
      <ul className="m-0 list-none divide-y divide-border p-0">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="font-mono text-xs text-muted-foreground">{it.time}</span>
            <span className="min-w-0 flex-1 text-foreground">{it.text}</span>
            <Badge variant={it.actor === "ai" ? "brand" : "outline"}>
              {it.actor === "ai" ? aiLabel : humanLabel}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
