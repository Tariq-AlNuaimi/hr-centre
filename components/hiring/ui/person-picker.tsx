"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { qs, useHiringQuery } from "./api";

export type Person = { id: string; name: string; email: string };

/**
 * Searchable person picker over `/api/hiring/directory` (Interview Hub
 * `RelationSelect` / directory search). Optionally narrowed to holders of a
 * permission for a company (approver / recipient / panel pickers).
 */
export function PersonPicker({
  id,
  value,
  onChange,
  permission,
  entityId,
  placeholder,
}: {
  id: string;
  value: Person | null;
  onChange: (p: Person | null) => void;
  permission?: string;
  entityId?: string | null;
  placeholder?: string;
}) {
  const t = useTranslations("hiring.common");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useHiringQuery<Person[]>(
    open ? `/api/hiring/directory${qs({ search, permission, entityId })}` : null,
  );
  if (value && !open) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-input px-3 py-1.5 text-sm">
        <span className="min-w-0 truncate text-foreground">
          {value.name} <span className="text-muted-foreground">· {value.email}</span>
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
          {t("change")}
        </Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input
        id={id}
        value={search}
        placeholder={placeholder ?? t("searchPeople")}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        autoComplete="off"
      />
      {open ? (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {isLoading ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">{t("loading")}</li>
          ) : null}
          {data?.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">{t("noPeople")}</li>
          ) : null}
          {data?.map((p) => (
            <li key={p.id} role="option" aria-selected={value?.id === p.id}>
              <button
                type="button"
                className="w-full rounded px-2 py-1.5 text-start text-sm hover:bg-muted"
                onClick={() => {
                  onChange(p);
                  setOpen(false);
                  setSearch("");
                }}
              >
                {p.name} <span className="text-muted-foreground">· {p.email}</span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="w-full rounded px-2 py-1.5 text-start text-xs text-muted-foreground hover:bg-muted"
              onClick={() => setOpen(false)}
            >
              {t("close")}
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
