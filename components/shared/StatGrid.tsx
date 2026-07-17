import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatGridProps {
  children: ReactNode;
  /** Max columns at the widest breakpoint (2–4). Always 1 column on mobile. */
  columns?: 2 | 3 | 4;
  className?: string;
}

const COLS: Record<NonNullable<StatGridProps["columns"]>, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

/**
 * StatGrid (V2-302 layout primitive). The responsive grid a row of `StatCard`s lives
 * in — it owns the **gap and the column counts** on the token scale (1 col on mobile,
 * up to `columns` at the widest breakpoint) so dashboards don't re-derive grid classes
 * per page. Semantic only; the cards bring their own surface. RTL-safe (grid mirrors).
 *
 * Compose: `<StatGrid columns={4}><StatCard …/> …</StatGrid>`.
 */
export function StatGrid({ children, columns = 4, className }: StatGridProps) {
  return <div className={cn("grid grid-cols-1 gap-4", COLS[columns], className)}>{children}</div>;
}
