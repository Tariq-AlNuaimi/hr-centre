import type { ReactNode } from "react";

export interface ToolbarProps {
  /** Inline-start slot — search, filters, view controls. */
  start?: ReactNode;
  /** Inline-end slot — the primary + secondary actions. */
  end?: ReactNode;
}

/**
 * Toolbar (ADR-029, Workstream C2 — shadcn/Tailwind rebuild, same prop API).
 * A list/section action bar: filters/search on the inline-start, actions on the
 * inline-end, wrapping + RTL-correct (flex + logical order, no physical
 * left/right).
 */
export function Toolbar({ start, end }: ToolbarProps) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-2">{start}</div>
      {end && <div className="flex flex-wrap items-center gap-2">{end}</div>}
    </div>
  );
}
