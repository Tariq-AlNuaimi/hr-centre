"use client";

// Public entry point for the Chart component. The heavy recharts bundle (~50KB)
// lives in ./Chart.impl and is loaded lazily via next/dynamic with { ssr: false },
// so pages that never render a chart don't pay for recharts. The public API
// (the `Chart` component + its exported types) is unchanged -- existing imports
// from "@/components/shared/Chart" keep working.

import dynamic from "next/dynamic";
import type { ChartProps, ChartType } from "./Chart.impl";

/** @public */
export type { ChartProps, ChartType };

// `dynamic` erases the generic signature, so re-assert it on the exported binding.
export const Chart = dynamic(() => import("./Chart.impl").then((m) => m.Chart), { ssr: false }) as <
  T extends Record<string, unknown>,
>(
  props: ChartProps<T>,
) => React.ReactElement;

// --- Tremor-style named surface (ADR-029, Workstream C2) --------------------
// @tremor/react was deferred (hard react@^18 peer, incompatible with React 19 —
// see Chart.impl header). recharts stays the engine; these thin named wrappers
// give the ergonomic Tremor-like surface (`<LineChart data=… />`) on top of the
// single declarative `Chart`, so callers can pick either style.
type NamedChartProps<T extends Record<string, unknown>> = Omit<ChartProps<T>, "type">;

/** @public */
export function LineChart<T extends Record<string, unknown>>(props: NamedChartProps<T>) {
  return <Chart type="line" {...props} />;
}
/** @public */
export function BarChart<T extends Record<string, unknown>>(props: NamedChartProps<T>) {
  return <Chart type="bar" {...props} />;
}
/** @public */
export function AreaChart<T extends Record<string, unknown>>(props: NamedChartProps<T>) {
  return <Chart type="area" {...props} />;
}
/** @public */
export function PieChart<T extends Record<string, unknown>>(props: NamedChartProps<T>) {
  return <Chart type="pie" {...props} />;
}
