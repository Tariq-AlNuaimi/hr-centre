"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { DomainScoreRow, FacetScoreRow } from "@/lib/scoring-rollup";

// Trait detail (UI-SPEC D.7 §4): the five Big Five domains as horizontal percentile
// bars vs the community midpoint (50), with collapsible per-domain facet detail.
// On-token fills, tabular-nums. The percentile number is the accessible value; the
// bar is decorative (aria-hidden). 0 is a valid percentile (=== null guards live in
// the service, not here — these are always numbers).
export function TraitDetail({
  domains,
  facets,
  domainLabels,
}: {
  domains: DomainScoreRow[];
  facets: FacetScoreRow[];
  domainLabels: Record<string, string>;
}) {
  const t = useTranslations("results");
  const facetLabels = useTranslations("roleProfiles.facets");
  const [open, setOpen] = React.useState<string | null>(null);

  const facetsByDomain = React.useMemo(() => {
    const map = new Map<string, FacetScoreRow[]>();
    for (const f of facets) {
      const list = map.get(f.domain) ?? [];
      list.push(f);
      map.set(f.domain, list);
    }
    return map;
  }, [facets]);

  function facetLabel(key: string): string {
    return facetLabels.has(key) ? facetLabels(key) : key;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("traitTitle")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("traitSubtitle")}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {domains.map((d) => {
          const domainFacets = facetsByDomain.get(d.domain) ?? [];
          const isOpen = open === d.domain;
          const label = domainLabels[d.domain] ?? d.domain;
          return (
            <div key={d.domain} className="rounded-md border border-border">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : d.domain)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <span className="w-32 shrink-0 text-sm font-medium text-foreground">
                  {label}
                </span>
                <Bar percentile={d.percentile} />
                <span className="w-10 shrink-0 text-end tabular-nums text-sm text-foreground">
                  {t("percentileLabel", { pct: d.percentile })}
                </span>
                <ChevronDown
                  aria-hidden
                  className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                    isOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {isOpen && domainFacets.length > 0 && (
                <div className="flex flex-col gap-1.5 border-t border-border px-3 py-3">
                  {domainFacets.map((f) => (
                    <div key={f.facet} className="flex items-center gap-3">
                      <span className="w-32 shrink-0 text-xs text-muted-foreground">
                        {facetLabel(f.facet)}
                      </span>
                      <Bar percentile={f.percentile} subtle />
                      <span className="w-10 shrink-0 text-end tabular-nums text-xs text-muted-foreground">
                        {t("percentileLabel", { pct: f.percentile })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function Bar({ percentile, subtle }: { percentile: number; subtle?: boolean }) {
  return (
    <span
      aria-hidden
      className="relative h-2 flex-1 overflow-hidden rounded-full bg-secondary"
    >
      {/* community midpoint reference at P50 */}
      <span className="absolute inset-y-0 start-1/2 w-px bg-border" />
      <span
        className={`block h-full rounded-full ${subtle ? "bg-accent/60" : "bg-accent"}`}
        style={{ width: `${Math.max(0, Math.min(100, percentile))}%` }}
      />
    </span>
  );
}
