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

export type RadarDatum = {
  competency: string;
  candidate: number;
  target: number;
};

// Competency radar (UI-SPEC D.7 §2): candidate score vs the role's target per
// competency. Named series + a legend keep it accessible; colors are on-token
// (azure for the candidate, sand for the target — the gold connects fit→target,
// rationed to the evidence trail).
export function CompetencyRadar({
  data,
  candidateLabel,
  targetLabel,
}: {
  data: RadarDatum[];
  candidateLabel: string;
  targetLabel: string;
}) {
  return (
    <div className="h-80 w-full" role="img" aria-label={`${candidateLabel} / ${targetLabel}`}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
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
            dataKey="target"
            stroke="var(--rihal-sand)"
            fill="var(--rihal-sand)"
            fillOpacity={0.12}
          />
          <Radar
            name={candidateLabel}
            dataKey="candidate"
            stroke="var(--accent)"
            fill="var(--accent)"
            fillOpacity={0.22}
          />
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
  );
}
