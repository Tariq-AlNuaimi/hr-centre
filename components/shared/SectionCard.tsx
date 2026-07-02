import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SectionCardProps {
  /** Section heading. */
  title: ReactNode;
  /** Optional one-line description under the title. */
  subtitle?: ReactNode;
  /** Inline-end slot for the section's actions (RTL-mirrors automatically). */
  actions?: ReactNode;
  /** Remove body padding (e.g. when embedding a full-bleed Table). */
  noBodyPadding?: boolean;
  children: ReactNode;
  style?: React.CSSProperties;
}

/**
 * SectionCard (ADR-029, Workstream C2 — shadcn/Tailwind rebuild, same prop API).
 * A titled content panel — heading + optional subtitle on the inline-start,
 * actions on the inline-end, a divider, then content. On-token surface (card bg,
 * border, radius, shadow) with `dark:` pairs; logical spacing so the header
 * mirrors correctly under RTL.
 */
export function SectionCard({
  title,
  subtitle,
  actions,
  noBodyPadding,
  children,
  style,
}: SectionCardProps) {
  return (
    <div
      style={style}
      className="rounded-md border border-border bg-card shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-3">
        <div className="min-w-0">
          <h3 className="m-0 text-h5 font-semibold text-card-foreground">
            {title}
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      <div className={cn(noBodyPadding ? "p-0" : "p-6")}>{children}</div>
    </div>
  );
}
