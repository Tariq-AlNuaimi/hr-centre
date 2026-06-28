"use client";

// Public entry point for the Chart component. The heavy recharts bundle (~50KB)
// lives in ./Chart.impl and is loaded lazily via next/dynamic with { ssr: false },
// so pages that never render a chart don't pay for recharts. The public API
// (the `Chart` component + its exported types) is unchanged -- existing imports
// from "@/components/shared/Chart" keep working.

import dynamic from "next/dynamic";
import type { ChartProps, ChartType } from "./Chart.impl";

export type { ChartProps, ChartType };

// `dynamic` erases the generic signature, so re-assert it on the exported binding.
export const Chart = dynamic(
  () => import("./Chart.impl").then((m) => m.Chart),
  { ssr: false }
) as <T extends Record<string, unknown>>(props: ChartProps<T>) => React.ReactElement;
