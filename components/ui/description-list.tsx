import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * DescriptionList — accessible key/value detail primitive (ADR-029, Workstream
 * C3). Semantic `<dl>` with `<dt>`/`<dd>` pairs on a responsive grid (one column
 * on narrow screens, `columns` on md+), on the semantic surface tokens so dark
 * mode is the single [data-theme="dark"] variable swap. Logical spacing + grid
 * mirror correctly under RTL. Replaces AntD `<Descriptions>`; the app-level
 * variant with size/span controls lives in the shared `DescriptionList`.
 */

export interface DescriptionListItem {
  /** Stable key for React. */
  key?: string;
  label: React.ReactNode;
  value: React.ReactNode;
}

export interface DescriptionListProps
  extends React.HTMLAttributes<HTMLDListElement> {
  items: DescriptionListItem[];
  /** Columns at md+ breakpoint (collapses to 1 on narrow screens). Default 1. */
  columns?: number;
  /** Hairline borders around each cell. Default true. */
  bordered?: boolean;
}

export function DescriptionList({
  items,
  columns = 1,
  bordered = true,
  className,
  style,
  ...props
}: DescriptionListProps) {
  return (
    <dl
      className={cn(
        "grid grid-cols-1 gap-px overflow-hidden rounded-md",
        columns > 1 && "md:grid-cols-[var(--dl-cols)]",
        className,
      )}
      style={
        columns > 1
          ? ({
              ["--dl-cols" as string]: `repeat(${columns}, minmax(0, 1fr))`,
              ...style,
            } as React.CSSProperties)
          : style
      }
      {...props}
    >
      {items.map((it, i) => (
        <div
          key={it.key ?? i}
          className={cn(
            "px-4 py-3",
            bordered && "bg-muted outline outline-1 outline-border",
          )}
        >
          <dt className="text-xs font-medium text-muted-foreground">
            {it.label}
          </dt>
          <dd className="m-0 mt-0.5 text-sm text-foreground">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
