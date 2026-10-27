"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The one filter bar (UX review P1-6 / tickets P1-11): a wrapping row of
 * labelled shadcn Selects and status chips with counts, used by list screens
 * across modules instead of each module's native selects.
 */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-end gap-3", className)}>{children}</div>;
}

/** Radix Select cannot hold an empty value, so "All" is this sentinel. */
const ALL = "__all__";

export type FilterOption = { value: string; label: string };

/** A labelled single-choice filter; `""` means "All". */
export function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  allLabel,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly FilterOption[];
  allLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-w-40 flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select
        value={value === "" ? ALL : value}
        onValueChange={(v) => onChange(v === ALL ? "" : v)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export type FilterChip = { value: string; label: string; count?: number };

/** Mutually exclusive chips (e.g. status) with optional counts; `""` is the "All" chip. */
export function FilterChips({
  label,
  value,
  onChange,
  chips,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  chips: readonly FilterChip[];
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {chips.map((chip) => {
        const active = chip.value === value;
        return (
          <button
            key={chip.value || "all"}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(chip.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-primary bg-accent-subtle font-medium text-nav-active-foreground"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {chip.label}
            {chip.count !== undefined ? (
              <span className="tabular-nums text-xs text-muted-foreground">{chip.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
