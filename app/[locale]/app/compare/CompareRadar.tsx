"use client";

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";

export type CompareRadarSeries = { name: string; key: string };

// Compare radar overlay (UI-SPEC D.8): each candidate's competency profile as a
// named series on shared axes, plus the role target. On-token series colors cycle
// through the brand palette; the legend names every series for accessibility.
// The overlay is a readable 2–3 candidate comparison (UI-SPEC D.8); beyond that it
// becomes unreadable, so it caps at RADAR_MAX and says so honestly — the table below
// always carries the full set (code-review: never silently drop candidates).
const SERIES_COLORS = ["var(--accent)", "var(--rihal-deep)", "var(--signal-pass)"];
const RADAR_MAX = SERIES_COLORS.length;

export function CompareRadar({
  data,
  series,
  targetKey,
  targetLabel,
  overflowNote,
}: {
  data: Record<string, string | number>[];
  series: CompareRadarSeries[];
  targetKey: string;
  targetLabel: string;
  /** Shown when the cohort exceeds RADAR_MAX so the trimmed overlay is honest. */
  overflowNote?: string;
}) {
  const shown = series.slice(0, RADAR_MAX);
  return (
    <div
      role="img"
      aria-label={[...shown.map((s) => s.name), targetLabel].join(", ")}
    >
      {series.length > RADAR_MAX && overflowNote && (
        <p className="mb-2 text-xs text-muted-foreground">{overflowNote}</p>
      )}
      <div className="h-96 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="70%">
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis
            dataKey="competency"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          />
          <PolarRadiusAxis
            domain={[0, 100]}
            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            stroke="var(--border)"
          />
          <Radar
            name={targetLabel}
            dataKey={targetKey}
            stroke="var(--rihal-sand)"
            fill="var(--rihal-sand)"
            fillOpacity={0.08}
          />
          {shown.map((s, i) => (
            <Radar
              key={s.key}
              name={s.name}
              dataKey={s.key}
              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              fill={SERIES_COLORS[i % SERIES_COLORS.length]}
              fillOpacity={0.14}
            />
          ))}
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }} />
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--popover-foreground)",
              fontSize: 12,
            }}
          />
        </RadarChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}
