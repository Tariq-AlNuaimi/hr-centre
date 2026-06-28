"use client";

// Thin wrapper over recharts. Picked over @ant-design/plots for explicit
// React 19 compatibility and a smaller client bundle (~50KB recharts vs
// ~700KB plots+G2). Visual style is intentionally minimal -- override colors
// per project if you need the Ant Design palette.
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
import { chartPalette } from "@/components/layout/antd-theme";

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
  /**
   * Accessible name for the chart's SVG (WCAG: an `<svg role="img">` needs an
   * accessible name, or axe flags svg-img-alt). Rendered as the recharts
   * `<title>` and mirrored onto an `aria-label`. REQUIRED — a chart with no
   * accessible name is an axe violation; pass a meaningful description of what
   * the chart shows (use a visually-hidden-friendly label even if a heading
   * already names the card).
   */
  title: string;
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
  title,
}: ChartProps<T>) {
  const { isDark } = useTheme();
  // Read grid contrast from the active theme so the grid is visible on the dark
  // background instead of vanishing into it.
  const gridStroke = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.06)";
  // recharts renders an `<svg role="img">`; without a name axe flags svg-img-alt.
  // `title` becomes the recharts `<title>` element AND an aria-label fallback.
  const a11y = { role: "img", "aria-label": title, title } as const;

  if (type === "line") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} {...a11y}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          <XAxis dataKey={xKey} />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey={yKey}
            stroke={colors[0]}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (type === "bar") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} {...a11y}>
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
        <AreaChart data={data} {...a11y}>
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
        <PieChart {...a11y}>
          <Tooltip />
          <Legend />
          <Pie
            data={data}
            dataKey={valueKey}
            nameKey={nameKey}
            cx="50%"
            cy="50%"
            outerRadius="80%"
            label
          >
            {data.map((d, i) => (
              // recharts stamps role="img" on each sector <path>; give it an
              // accessible name ("<slice>: <value>") so axe svg-img-alt passes.
              <Cell
                key={i}
                fill={colors[i % colors.length]}
                role="img"
                aria-label={`${String(d[nameKey])}: ${String(d[valueKey])}`}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    );
  }

  return null;
}
