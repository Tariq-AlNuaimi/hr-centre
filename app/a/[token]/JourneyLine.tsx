"use client";

// The "journey line" (UI-SPEC A.5 / C): the one orchestrated motion moment — a
// thin azure progress line that advances across the whole flow. The .journey-line
// component class (globals.css) sets the azure→sand fill width from --journey and
// suppresses its transition under prefers-reduced-motion (handled globally in
// the @media rule). role=progressbar exposes the value to assistive tech.
export function JourneyLine({
  percent,
  label,
}: {
  percent: number; // 0..100
  label: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      className="journey-line"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      style={{ "--journey": `${clamped}%` } as React.CSSProperties}
    />
  );
}
