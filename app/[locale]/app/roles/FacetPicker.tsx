"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, X } from "lucide-react";
import { IPIP_FACETS_BY_DOMAIN, BIG5_DOMAINS } from "@/lib/ipip-facets";
import { cn } from "@/lib/utils";

const DOMAINS = BIG5_DOMAINS;

// Grouped facet multi-select (UI-SPEC D.3 step 3). Disclosure panel of native
// checkboxes grouped by OCEAN domain — no extra dep, fully keyboard/AT accessible.
// Selected facets show as removable chips above the trigger.
export function FacetPicker({
  value,
  onChange,
  invalid,
  labelId,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  invalid?: boolean;
  labelId?: string;
}) {
  const t = useTranslations("roleProfiles");
  const tFacet = useTranslations("roleProfiles.facets");
  const tDomain = useTranslations("roleProfiles.domains");
  const [open, setOpen] = React.useState(false);

  function toggle(facet: string) {
    onChange(
      value.includes(facet)
        ? value.filter((f) => f !== facet)
        : [...value, facet]
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((facet) => (
            <li key={facet}>
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                {tFacet(facet)}
                <button
                  type="button"
                  onClick={() => toggle(facet)}
                  className="rounded-full p-0.5 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("removeFacet", { facet: tFacet(facet) })}
                >
                  <X className="size-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-labelledby={labelId}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-md border bg-card px-3 text-sm text-muted-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          invalid ? "border-[var(--signal-below)]" : "border-input"
        )}
      >
        <span>
          {value.length > 0
            ? t("facetsSelected", { count: value.length })
            : t("facetsPlaceholder")}
        </span>
        <ChevronDown
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="rounded-md border border-border bg-card p-2 shadow-[var(--shadow-card)]">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {DOMAINS.map((domain) => (
              <fieldset key={domain} className="flex flex-col gap-1">
                <legend className="mb-1 text-xs font-semibold text-foreground">
                  {tDomain(domain)}
                </legend>
                {IPIP_FACETS_BY_DOMAIN[domain].map((facet) => {
                  const checked = value.includes(facet);
                  return (
                    <label
                      key={facet}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-secondary"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(facet)}
                        className="size-4 rounded border-input text-accent accent-[var(--rihal-azure)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <span className="text-foreground">{tFacet(facet)}</span>
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
