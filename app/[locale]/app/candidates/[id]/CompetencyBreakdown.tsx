"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Quote } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { BandPill } from "./BandPill";
import type { CompetencyScoreRow } from "@/lib/scoring-rollup";

// Competency breakdown (UI-SPEC D.7 §3) — THE evidence trail. Each competency shows
// its score, a non-color-only band pill, and (on expand) the driving facets +
// source citation. The gold --rihal-sand connector is rationed here to link
// competency → source, the evidence-trail signature.
export function CompetencyBreakdown({
  competencies,
  bandLabels,
}: {
  competencies: CompetencyScoreRow[];
  bandLabels: Record<"PASS" | "PARTIAL" | "BELOW", string>;
}) {
  const t = useTranslations("results");
  const facetLabels = useTranslations("roleProfiles.facets");
  const [open, setOpen] = React.useState<Set<string>>(new Set());

  function toggle(name: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function facetLabel(key: string): string {
    return facetLabels.has(key) ? facetLabels(key) : key;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("breakdownTitle")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("breakdownSubtitle")}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {competencies.map((c) => {
          const isOpen = open.has(c.name);
          return (
            <div key={c.name} className="rounded-md border border-border">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => toggle(c.name)}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <span className="flex-1 text-sm font-medium text-foreground">{c.name}</span>
                <span className="tabular-nums text-sm text-muted-foreground">
                  {t("scoreLabel", { score: c.score })}
                </span>
                <span className="tabular-nums text-xs text-muted-foreground">
                  {t("targetLabel", { pct: c.targetPercentile })}
                </span>
                <BandPill band={c.band} label={bandLabels[c.band]} />
                <ChevronDown
                  aria-hidden
                  className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                    isOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {isOpen && (
                <div className="flex flex-col gap-3 border-t border-[var(--rihal-sand)]/40 px-3 py-3">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t("driversLabel")}
                    </span>
                    <div className="flex flex-col gap-1">
                      {c.drivers.map((d) => (
                        <div key={d.facet} className="flex items-center gap-3 text-sm">
                          <span className="w-36 shrink-0 text-foreground">
                            {facetLabel(d.facet)}
                          </span>
                          <span
                            aria-hidden
                            className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-secondary"
                          >
                            <span
                              className="block h-full rounded-full bg-accent"
                              style={{ width: `${Math.max(0, Math.min(100, d.percentile))}%` }}
                            />
                          </span>
                          <span className="w-10 shrink-0 text-end tabular-nums text-xs text-muted-foreground">
                            {t("percentileLabel", { pct: d.percentile })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-start gap-2 border-s-2 border-[var(--rihal-sand)] ps-3">
                    <Quote aria-hidden className="mt-0.5 size-3.5 shrink-0 text-[var(--rihal-sand)]" />
                    <div className="flex flex-col">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t("sourceLabel")}
                      </span>
                      <span className="text-sm text-foreground">
                        {c.sourceCitation || c.onetRef || t("noSource")}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
