"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { useZodForm, Form, TextField } from "@/components/shared/FormField";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { assetStatusLabel, assetCategoryLabel } from "@/components/asset/asset-labels";

interface AssetFormProps {
  initialValues?: Partial<{
    assetTag: string;
    name: string;
    serial?: string | null;
    purchasedAt?: string | null;
    status: "IN_STOCK" | "ASSIGNED" | "REPAIR" | "RETIRED";
    category: "LAPTOP" | "MONITOR" | "PHONE" | "OTHER";
    assigneeId?: string | null;
  }>;
  onSubmit: (values: {
    assetTag: string;
    name: string;
    serial?: string | null;
    purchasedAt?: string | null;
    status: "IN_STOCK" | "ASSIGNED" | "REPAIR" | "RETIRED";
    category: "LAPTOP" | "MONITOR" | "PHONE" | "OTHER";
    assigneeId?: string | null;
  }) => void;
  onCancel: () => void;
  loading?: boolean;
}

function RelationSelect({
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

export function AssetForm({ initialValues, onSubmit, onCancel, loading = false }: AssetFormProps) {
  const t = useTranslations("assets");

  // The SAME shape guards the API route; client + server validation can't drift.
  const schema = z.object({
    assetTag: z.string().min(1),
    name: z.string().min(1),
    serial: z.string().nullish(),
    purchasedAt: z.string().nullish(),
    status: z.enum(["IN_STOCK", "ASSIGNED", "REPAIR", "RETIRED"]),
    category: z.enum(["LAPTOP", "MONITOR", "PHONE", "OTHER"]),
    assigneeId: z.string().nullish(),
  });

  const form = useZodForm(schema, {
    defaultValues: {
      assetTag: initialValues?.assetTag ?? "",
      name: initialValues?.name ?? "",
      serial: initialValues?.serial ?? "",
      purchasedAt: initialValues?.purchasedAt ?? "",
      status: initialValues?.status ?? "IN_STOCK",
      category: initialValues?.category ?? "LAPTOP",
      assigneeId: initialValues?.assigneeId ?? undefined,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex max-w-[500px] flex-col gap-4">
        <TextField name="assetTag" label={t("assetTag")} />

        <TextField name="name" label={t("name")} />

        <TextField name="serial" label={t("serial")} />

        <TextField name="purchasedAt" label={t("purchasedAt")} type="date" />

        <FormField
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("status")}</FormLabel>
              <Select value={field.value ?? undefined} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={t("status")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="IN_STOCK">{assetStatusLabel("IN_STOCK")}</SelectItem>
                  <SelectItem value="ASSIGNED">{assetStatusLabel("ASSIGNED")}</SelectItem>
                  <SelectItem value="REPAIR">{assetStatusLabel("REPAIR")}</SelectItem>
                  <SelectItem value="RETIRED">{assetStatusLabel("RETIRED")}</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("category")}</FormLabel>
              <Select value={field.value ?? undefined} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={t("category")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="LAPTOP">{assetCategoryLabel("LAPTOP")}</SelectItem>
                  <SelectItem value="MONITOR">{assetCategoryLabel("MONITOR")}</SelectItem>
                  <SelectItem value="PHONE">{assetCategoryLabel("PHONE")}</SelectItem>
                  <SelectItem value="OTHER">{assetCategoryLabel("OTHER")}</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          name="assigneeId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("assignee")}</FormLabel>
              <RelationSelect
                path="/api/users"
                displayField="name"
                placeholder={t("assignee")}
                searchPlaceholder={t("searchRelation")}
                emptyLabel={t("noRelationMatches")}
                value={field.value ?? undefined}
                onChange={field.onChange}
              />
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex gap-2">
          <Button type="submit" disabled={loading}>
            {t("save")}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
        </div>
      </form>
    </Form>
  );
}
