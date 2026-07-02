import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Local size union (matches the old AntD `DescriptionsProps["size"]`). */
export type DescriptionListSize = "default" | "middle" | "small";

export interface DescriptionItem {
  key: string;
  label: ReactNode;
  value: ReactNode;
  /** Column span for this item (grid tracks it occupies). */
  span?: number;
}

export interface DescriptionListProps {
  items: DescriptionItem[];
  /** Columns at the widest breakpoint (collapses to 1 on narrow screens). */
  columns?: number;
  bordered?: boolean;
  title?: ReactNode;
  size?: DescriptionListSize;
}

const CELL_PADDING: Record<DescriptionListSize, string> = {
  small: "px-3 py-2",
  middle: "px-4 py-3",
  default: "px-5 py-4",
};

/**
 * DescriptionList (ADR-029, Workstream C2 — shadcn/Tailwind rebuild, same prop
 * API). Key/value detail view on a responsive CSS grid: one column on narrow
 * screens, `columns` on md+. On-token surface + borders with `dark:` pairs;
 * grid + logical spacing mirror correctly under RTL.
 */
export function DescriptionList({
  items,
  columns = 2,
  bordered = true,
  title,
  size = "middle",
}: DescriptionListProps) {
  const pad = CELL_PADDING[size];

  return (
    <div>
      {title && (
        <h3 className="mb-3 text-h5 font-semibold text-gray-900 dark:text-gray-50">
          {title}
        </h3>
      )}
      <dl
        className="grid grid-cols-1 gap-px overflow-hidden rounded-md md:grid-cols-[var(--dl-cols)]"
        style={{ "--dl-cols": `repeat(${columns}, minmax(0, 1fr))` } as CSSProperties}
      >
        {items.map((it) => (
          <div
            key={it.key}
            style={
              it.span
                ? ({ gridColumn: `span ${it.span}` } as CSSProperties)
                : undefined
            }
            className={cn(
              pad,
              bordered
                ? "bg-gray-50 outline outline-1 outline-gray-200 dark:bg-gray-950 dark:outline-gray-800"
                : "",
            )}
          >
            <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {it.label}
            </dt>
            <dd className="mt-0.5 m-0 text-sm text-gray-900 dark:text-gray-100">
              {it.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
