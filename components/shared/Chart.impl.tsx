"use client";

// Thin wrapper over recharts. Picked over @ant-design/plots for explicit
// React 19 compatibility and a smaller client bundle (~50KB recharts vs
// ~700KB plots+G2). Visual style is intentionally minimal -- override colors
// per project if you need the Ant Design palette.
//
// ADR-029, Workstream C2: @tremor/react was evaluated as the charting layer but
// DEFERRED — its latest release (3.18.7) declares a hard `react@^18` peer and
// fails to resolve against this repo's React 19 (ERESOLVE). We do not force it
// with --legacy-peer-deps (papering over a real incompat). recharts stays the
// engine; the declarative `Chart` component below IS the Tremor-style surface
// (one `<Chart type=… data=… />` per viz). Revisit Tremor when it ships a
// React 19-compatible release.
//
// Example:
//
//   const data = [
//     { month: "Jan", revenue: 4200 },
//     { month: "Feb", revenue: 5100 },
//     { month: "Mar", revenue: 4800 },
//   ];
//
//   <Chart type="line" data={data} xKey="month" yKey="revenue" height={280} />
//   <Chart type="bar"  data={data} xKey="month" yKey="revenue" />
//   <Chart type="area" data={data} xKey="month" yKey="revenue" />
//
//   const dist = [
//     { name: "TODO", value: 12 },
//     { name: "DONE", value: 30 },
//   ];
//   <Chart type="pie" data={dist} nameKey="name" valueKey="value" />

import {
  LineChart,
  BarChart,
  AreaChart,
  PieChart,
  Line,
  Bar,
  Area,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useTheme } from "@/components/layout/ThemeProvider";
import { chartPalette } from "@/components/shared/chart-palette";

export type ChartType = "line" | "bar" | "area" | "pie";

export interface ChartProps<T extends Record<string, unknown>> {
  type: ChartType;
  data: T[];
  height?: number;
  /** For line/bar/area: the categorical (usually x) axis key. */
  xKey?: string;
  /** For line/bar/area: the numeric (usually y) axis key. */
  yKey?: string;
  /** For pie: which property is the slice label. */
  nameKey?: string;
  /** For pie: which property is the slice value. */
  valueKey?: string;
  /** Override the default palette. */
  colors?: string[];
}

const DEFAULT_COLORS = chartPalette;

export function Chart<T extends Record<string, unknown>>({
  type,
  data,
  height = 320,
  xKey = "x",
  yKey = "y",
  nameKey = "name",
  valueKey = "value",
  colors = DEFAULT_COLORS,
}: ChartProps<T>) {
  const { isDark } = useTheme();
  // Read grid contrast from the active theme so the grid is visible on the dark
  // background instead of vanishing into it.
  const gridStroke = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.06)";

  if (type === "line") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          <XAxis dataKey={xKey} />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey={yKey} stroke={colors[0]} strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (type === "bar") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          <XAxis dataKey={xKey} />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar dataKey={yKey} fill={colors[0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (type === "area") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          <XAxis dataKey={xKey} />
          <YAxis />
          <Tooltip />
          <Legend />
          <Area
            type="monotone"
            dataKey={yKey}
            stroke={colors[0]}
            fill={colors[0]}
            fillOpacity={0.3}
          />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (type === "pie") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Tooltip />
          <Legend />
          <Pie
            data={data}
            dataKey={valueKey}
            nameKey={nameKey}
            cx="50%"
            cy="50%"
            // Donut, not a full pie: an inner cutout reads as a modern KPI ring
            // and stays legible when a single category fills the whole circle
            // (the old full pie showed a bare wedge). paddingAngle separates
            // adjacent slices with a hairline gap.
            innerRadius="58%"
            outerRadius="80%"
            paddingAngle={data.length > 1 ? 2 : 0}
            label
            // No leader label-lines (Workstream D a11y): recharts forwards Cell
            // props to BOTH the sector AND its leader line, so each slice was
            // announced twice by AT. Dropping the line leaves one accessible
            // sector per slice — the `label` text still renders at each arc.
            labelLine={false}
          >
            {data.map((d, i) => (
              // a11y: recharts gives each sector role="img" with no accessible
              // name (svg-img-alt), so set role + aria-label on the Cell. With
              // labelLine={false} above there is no leader line to double-announce.
              <Cell
                key={i}
                fill={colors[i % colors.length]}
                role="img"
                aria-label={`${String(d[nameKey] ?? "")}: ${String(d[valueKey] ?? "")}`}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    );
  }

  return null;
}
