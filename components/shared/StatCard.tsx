import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  /** Metric label (e.g. "Total users"). */
  title: ReactNode;
  /** The headline value. */
  value: ReactNode;
  /** Optional leading icon, shown in a tinted brand chip. */
  icon?: ReactNode;
  /** Optional trend: positive = up (good by default), negative = down. */
  trend?: { value: number; direction: "up" | "down"; positiveIsGood?: boolean };
  /** Optional muted line under the value (context for the number). */
  hint?: ReactNode;
}

/**
 * StatCard (ADR-029, Workstream C2 — shadcn/Tailwind rebuild, same prop API).
 * Branded KPI card: a tinted brand chip for the icon, a large value, and an
 * optional trend pill with semantic color. On-token surface + brand utilities
 * with `dark:` pairs; logical gaps mirror correctly under RTL.
 */
export function StatCard({ title, value, icon, trend, hint }: StatCardProps) {
  const trendUp = trend?.direction === "up";
  const positiveIsGood = trend?.positiveIsGood ?? true;
  // "Good" = up when up is good, or down when down is good.
  const isGood = trendUp === positiveIsGood;

  return (
    <div className="rounded-md border border-border bg-card p-6 shadow-sm">
      <div className="flex items-start gap-3">
        {icon && (
          <span
            aria-hidden
            className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-md bg-primary/10 text-lg text-primary"
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <span className="text-sm text-muted-foreground">
            {title}
          </span>
          <div className="mt-0.5 flex items-baseline gap-3">
            <span className="text-h2 font-bold leading-none tracking-tight text-card-foreground">
              {value}
            </span>
            {trend && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 text-xs font-semibold",
                  isGood
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400",
                )}
              >
                <svg
                  aria-hidden
                  viewBox="0 0 12 12"
                  className={cn("h-3 w-3", trendUp ? "" : "rotate-180")}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 10V2M3 5l3-3 3 3" />
                </svg>
                {Math.abs(trend.value)}%
              </span>
            )}
          </div>
          {hint && (
            <div className="text-xs text-muted-foreground">{hint}</div>
          )}
        </div>
      </div>
    </div>
  );
}
