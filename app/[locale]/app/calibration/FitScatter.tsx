"use client";

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// Predicted-fit-vs-observed-success scatter (UI-SPEC D.9). One point per hired,
// outcome-recorded candidate. On-token colors (azure points, hairline grid) so dark
// + RTL follow the theme via CSS vars. Labelled for screen readers; the numeric
// correlation is shown alongside in the panel for non-visual readers.
export function FitScatter({
  points,
  fitLabel,
  successLabel,
  ariaLabel,
}: {
  points: { fit: number; success: number }[];
  fitLabel: string;
  successLabel: string;
  ariaLabel: string;
}) {
  // Plot success as a 0–100 percentage for a readable axis.
  const data = points.map((p) => ({ fit: p.fit, success: Math.round(p.success * 100) }));
  return (
    <div className="h-72 w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="fit"
            domain={[0, 100]}
            name={fitLabel}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            stroke="var(--border)"
            label={{ value: fitLabel, position: "insideBottom", offset: -12, fill: "var(--muted-foreground)", fontSize: 12 }}
          />
          <YAxis
            type="number"
            dataKey="success"
            domain={[0, 100]}
            name={successLabel}
            unit="%"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            stroke="var(--border)"
          />
          <ZAxis range={[60, 60]} />
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--popover-foreground)",
              fontSize: 12,
            }}
          />
          <Scatter data={data} fill="var(--accent)" fillOpacity={0.7} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
