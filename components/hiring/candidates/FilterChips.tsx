"use client";

import { cn } from "@/lib/utils";

/** A row of single-select filter pills (Interview Hub FilterChips / filter pills). */
export function FilterChips<V extends string | undefined>({
  label,
  options,
  active,
  onSelect,
}: {
  label: string;
  options: { value: V; label: string }[];
  active: V;
  onSelect: (v: V) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value ?? "all"}
          type="button"
          aria-pressed={o.value === active}
          onClick={() => onSelect(o.value)}
          className={cn(
            "rounded-full border px-3 py-1 text-sm",
            o.value === active
              ? "border-primary bg-accent-subtle font-medium text-primary-emphasis"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
