"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api-client";

/**
 * One search-and-pick control over the employee directory.
 *
 * Extracted the moment a third screen needed it (§9.6's rater editor, §9.6's
 * project mapping, §12's leaver and transfer forms). A fourth copy of
 * "search box, debounce-ish, filter out who is already chosen" is how four
 * screens end up disagreeing about who is offerable.
 *
 * It offers ACTIVE employees and nothing else — a leaver is not a rater (§12.1)
 * and not a transfer subject. Everything beyond that is the route's to refuse:
 * this control is a directory search, not a rules engine, and the screens that
 * use it say so where it matters.
 */

export type PickablePerson = { id: string; name: string; email?: string };

export function EmployeePicker({
  id,
  label,
  exclude = [],
  onPick,
  minChars = 2,
}: {
  id: string;
  label: string;
  /** Ids already chosen (or the subject themselves) — never offered. */
  exclude?: string[];
  onPick: (person: PickablePerson) => void;
  minChars?: number;
}) {
  const t = useTranslations("pms.employeePicker");
  const [search, setSearch] = useState("");

  const people = useQuery({
    queryKey: ["pms", "employees", "picker", search],
    queryFn: () =>
      apiClient.get<{ data: PickablePerson[] }>(
        `/api/employees?pageSize=10&status=ACTIVE&search=${encodeURIComponent(search)}`,
      ),
    enabled: search.trim().length >= minChars,
  });

  const candidates = useMemo(() => {
    const taken = new Set(exclude);
    return (people.data?.data ?? []).filter((p) => !taken.has(p.id));
  }, [people.data, exclude]);

  const searching = search.trim().length >= minChars;

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={search}
        placeholder={t("placeholder")}
        onChange={(e) => setSearch(e.target.value)}
      />
      {searching && (
        <ul className="max-h-48 space-y-1 overflow-y-auto" aria-live="polite">
          {people.isLoading ? (
            <li className="p-2 text-sm text-muted-foreground">{t("searching")}</li>
          ) : candidates.length === 0 ? (
            <li className="p-2 text-sm text-muted-foreground">{t("noMatches")}</li>
          ) : (
            candidates.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(person);
                    setSearch("");
                  }}
                  className="w-full rounded-md border border-border p-2 text-start text-sm hover:bg-muted"
                >
                  {person.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
