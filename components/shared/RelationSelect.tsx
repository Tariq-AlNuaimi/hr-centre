"use client";

import { useEffect, useRef, useState } from "react";
import { FormControl } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

/**
 * Shared relation-picker combobox: a searchable, debounced dropdown that fetches
 * `${path}?search=` and shows `row[displayField]`. Lifted verbatim from the picker
 * `scaffold-entity` emits inline in every relation-bearing form (build-vs-buy ledger,
 * 2026-07-18) so `AssetForm`/`AssetModelForm`/… share one implementation. Renders
 * inside a react-hook-form `FormField` (it consumes `FormControl`).
 */
export function RelationSelect({
  path,
  displayField,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  value,
  onChange,
}: {
  path: string;
  displayField: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  value?: string;
  onChange?: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [selectedLabel, setSelectedLabel] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Debounce so a keystroke doesn't fire a request per character. Empty query
    // seeds the initial page; a non-empty one narrows server-side.
    const timer = setTimeout(() => {
      const qs = new URLSearchParams({ pageSize: "50" });
      if (search) qs.set("search", search);
      fetch(path + "?" + qs.toString())
        .then((r) => r.json())
        .then((j: { data?: { data?: Array<{ id: string } & Record<string, unknown>> } }) => {
          const opts = (j.data?.data ?? []).map((row) => ({
            value: row.id,
            label: (row[displayField] as string | undefined) ?? row.id,
          }));
          setOptions(opts);
          // Keep the trigger label resolvable even after the list is filtered.
          const match = opts.find((o) => o.value === value);
          if (match) setSelectedLabel(match.label);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [path, displayField, search, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <FormControl>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="w-full justify-between font-normal">
            <span className={value ? "" : "text-muted-foreground"}>
              {selectedLabel ?? placeholder}
            </span>
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-4 w-4 flex-none opacity-60"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
            </svg>
          </Button>
        </PopoverTrigger>
      </FormControl>
      <PopoverContent
        align="start"
        // Focus the search box (not an option) when the popover opens.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
        className="w-[var(--radix-popover-trigger-width)] p-1"
      >
        <input
          ref={inputRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="mb-1 w-full rounded-sm border border-border bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="max-h-56 overflow-auto">
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">{emptyLabel}</p>
          ) : (
            options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange?.(o.value);
                  setSelectedLabel(o.label);
                  setOpen(false);
                }}
                className={
                  "flex w-full items-center rounded-sm px-2 py-1.5 text-start text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring " +
                  (o.value === value ? "font-medium text-primary-emphasis" : "text-foreground")
                }
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
