"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api-client";

type Account = { id: string; name: string | null; email: string };

/** Pick an ACCOUNT (assignments attach to a login, not an employee record). */
export function UserSearch({
  value,
  onChange,
}: {
  value: Account | null;
  onChange: (account: Account | null) => void;
}) {
  const t = useTranslations("rbac");
  const [term, setTerm] = useState("");
  const results = useQuery({
    queryKey: ["rbac", "user-search", term],
    queryFn: () =>
      apiClient.get<{ data: Account[] }>(
        `/api/users?pageSize=8&search=${encodeURIComponent(term)}`,
      ),
    enabled: term.trim().length >= 2,
  });

  if (value) {
    return (
      <p className="flex items-center gap-2 text-sm text-foreground">
        {value.name ?? value.email} <span className="text-muted-foreground">{value.email}</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
          {t("change")}
        </Button>
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <Input
        id="assign-user"
        value={term}
        placeholder={t("searchPeople")}
        onChange={(e) => setTerm(e.target.value)}
        aria-describedby="assign-user-hint"
      />
      <p id="assign-user-hint" className="text-xs text-muted-foreground">
        {t("searchHint")}
      </p>
      {(results.data?.data ?? []).length > 0 ? (
        <ul className="rounded-md border border-border">
          {results.data!.data.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-start text-sm hover:bg-muted"
                onClick={() => {
                  onChange(a);
                  setTerm("");
                }}
              >
                {a.name ?? a.email} <span className="text-muted-foreground">{a.email}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
