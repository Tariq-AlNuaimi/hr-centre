"use client";

import { useEffect, useState } from "react";

type Def = {
  id: string;
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN";
  required: boolean;
};

/**
 * Renders one input per active `CustomFieldDef` (T9), controlled as a single
 * `customFields` value object. Fetches the defs from `/api/custom-field-def`;
 * renders nothing when none are defined. On-token styling, no raw hex.
 */
export function CustomFields({
  value,
  onChange,
}: {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const [defs, setDefs] = useState<Def[]>([]);

  useEffect(() => {
    fetch("/api/custom-field-def?pageSize=100")
      .then((r) => r.json())
      .then((j: { data?: { data?: Def[] } }) => setDefs(j.data?.data ?? []))
      .catch(() => {});
  }, []);

  if (defs.length === 0) return null;

  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });

  return (
    <div className="flex flex-col gap-4">
      {defs.map((d) => (
        <div key={d.id} className="flex flex-col gap-2">
          <label htmlFor={`cf-${d.key}`} className="text-sm font-medium text-foreground">
            {d.label}
          </label>
          {d.type === "BOOLEAN" ? (
            <input
              id={`cf-${d.key}`}
              type="checkbox"
              checked={Boolean(value[d.key])}
              onChange={(e) => set(d.key, e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
          ) : (
            <input
              id={`cf-${d.key}`}
              type={d.type === "NUMBER" ? "number" : d.type === "DATE" ? "date" : "text"}
              required={d.required}
              value={(value[d.key] as string | number | undefined) ?? ""}
              onChange={(e) => set(d.key, e.target.value)}
              className="rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}
        </div>
      ))}
    </div>
  );
}
