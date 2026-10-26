"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useHiringMutation, useHiringQuery } from "./api";

type Competency = { id: string; name: string; category: string | null };

/**
 * Multi-select over the competency library, with "Add to library"
 * (Interview Hub `CompetencyMultiSelect`). Selected names are what a
 * requisition stores.
 */
export function CompetencyPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const t = useTranslations("hiring.common");
  const [search, setSearch] = useState("");
  const { data } = useHiringQuery<Competency[]>("/api/hiring/library/competencies");
  const add = useHiringMutation<{ name: string }, Competency>(
    "POST",
    "/api/hiring/library/competencies",
    {
      onSuccess: (c) => onChange([...value, c.name]),
    },
  );
  const q = search.trim().toLowerCase();
  const options = (data ?? []).filter(
    (c) => !value.includes(c.name) && c.name.toLowerCase().includes(q),
  );
  const exact = (data ?? []).some((c) => c.name.toLowerCase() === q);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {value.length === 0 ? (
          <span className="text-xs text-muted-foreground">{t("noneSelected")}</span>
        ) : null}
        {value.map((name) => (
          <Badge key={name} variant="brand">
            {name}
            <button
              type="button"
              aria-label={t("remove", { name })}
              className="ms-1"
              onClick={() => onChange(value.filter((v) => v !== name))}
            >
              ×
            </button>
          </Badge>
        ))}
      </div>
      <Input
        value={search}
        placeholder={t("searchCompetencies")}
        onChange={(e) => setSearch(e.target.value)}
      />
      {q ? (
        <div className="flex flex-wrap gap-1">
          {options.slice(0, 12).map((c) => (
            <Button
              key={c.id}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onChange([...value, c.name])}
            >
              {c.name}
            </Button>
          ))}
          {!exact ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={add.isPending}
              onClick={() => add.mutate({ name: search.trim() })}
            >
              {t("addToLibrary", { name: search.trim() })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
