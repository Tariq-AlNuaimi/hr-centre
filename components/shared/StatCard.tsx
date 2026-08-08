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
  /**
   * Optional sparkline series (oldest → newest). Rendered as a subtle area
   * micro-chart across the card foot. Pass REAL data only — an honest empty
   * (undefined / <2 points) simply hides it. On-token: strokes/fills use
   * `currentColor` from the brand-emphasis text color, no raw hex.
   */
  spark?: number[];
}

/** Subtle area sparkline. Normalizes the series into a 100×28 viewBox and draws
 *  a brand-colored line with a faint fill. Flat series (all-equal) render a
 *  centered baseline rather than dividing by zero. */
function Sparkline({ values }: { values: number[] }) {
  const w = 100;
  const h = 28;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = values.length > 1 ? (i / (values.length - 1)) * w : w / 2;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="mt-4 -mb-1 block h-7 w-full text-primary-emphasis"
    >
      <path d={area} fill="currentColor" fillOpacity={0.1} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * StatCard (ADR-029, Workstream C2 — shadcn/Tailwind rebuild, same prop API).
 * Branded KPI card: a tinted brand chip for the icon, a large value, an optional
 * trend pill with semantic color, and an optional real-data sparkline. On-token
 * surface + brand utilities; logical gaps mirror correctly under RTL.
 */
export function StatCard({ title, value, icon, trend, hint, spark }: StatCardProps) {
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
            className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-md bg-primary/10 text-lg text-primary-emphasis"
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <span className="text-sm text-muted-foreground">{title}</span>
          <div className="mt-0.5 flex items-baseline gap-3">
            <span className="text-h2 font-bold leading-none tracking-tight text-card-foreground">
              {value}
            </span>
            {trend && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 text-xs font-semibold",
                  isGood
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-red-700 dark:text-red-400",
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
          {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
        </div>
      </div>
      {spark && spark.length > 1 && <Sparkline values={spark} />}
    </div>
  );
}
