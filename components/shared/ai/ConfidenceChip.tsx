import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * ConfidenceChip — a compact 0–1 confidence read for an AI suggestion: three
 * segmented bars + the numeric value. The numeric label and the filled-bar count
 * are BOTH derived from the same `value`, so they can never disagree. Purely
 * presentational + on-token; name it for AT via `label` (an aria-label).
 */
export function ConfidenceChip({
  value,
  label = "Confidence",
  className,
}: {
  /** 0–1. Clamped; the filled bars and the printed number both come from this. */
  value: number;
  /** Accessible name (aria-label) — pass a localized string from the caller. */
  label?: string;
  className?: string;
}) {
  const v = Math.max(0, Math.min(1, value));
  const filled = Math.round(v * 3); // 0..3 segments
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary-emphasis",
        className,
      )}
      role="img"
      aria-label={`${label} ${v.toFixed(2)}`}
    >
      <span className="font-mono">{v.toFixed(2)}</span>
      <span aria-hidden className="inline-flex items-end gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              "w-1 rounded-[1px] bg-current",
              i < filled ? "opacity-100" : "opacity-30",
            )}
            style={{ height: 6 + i * 2 }}
          />
        ))}
      </span>
    </span>
  );
}
