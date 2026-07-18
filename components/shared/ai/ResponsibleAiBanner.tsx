import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * ResponsibleAiBanner — the standing "AI is advisory, a human decides" notice
 * (MIGRATION.md; the AI-Quality pillar, ADR-042). Info-toned, on-token. Title +
 * body come from props so the caller localizes them; sensible English defaults
 * are rendered via expressions (not literal JSX text).
 */
const SCALE_GLYPH = "⚖";

export function ResponsibleAiBanner({
  title = "Responsible AI",
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={cn(
        "flex gap-3 rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950",
        className,
      )}
    >
      <span
        aria-hidden
        className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-md bg-card text-sky-700 dark:text-sky-300"
      >
        {SCALE_GLYPH}
      </span>
      <div className="text-sm text-sky-800 dark:text-sky-200">
        <div className="mb-0.5 text-xs font-semibold uppercase tracking-wide">{title}</div>
        <p className="m-0 leading-relaxed">{children}</p>
      </div>
    </div>
  );
}
