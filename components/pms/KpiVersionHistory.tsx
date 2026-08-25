"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatDateTime } from "@/lib/format";

/**
 * §6.3 — "full version history: previous versions archived, never overwritten."
 *
 * Reads bottom-up: version 1 is the KPI as HR originally approved it, each later
 * row is the state that a subsequent approval replaced, and the LIVE row (shown
 * above this panel) is the current one. That ordering is why the archive stores
 * the superseded state rather than the new one — the current state already
 * exists, in the table it belongs to.
 *
 * An empty history is a real answer, not a missing feature: a baseline nobody
 * has changed has exactly one version, the live one.
 */

export interface KpiVersionRow {
  id: string;
  kpiId: string;
  kpiDescription: string;
  versionNo: number;
  description: string;
  weightage: string;
  descriptorOutstanding: string;
  descriptorExcellent: string;
  descriptorTarget: string;
  descriptorAlmostAchieved: string;
  descriptorUnsatisfactory: string;
  supersededAt: string;
  /** Which request replaced this version — how a decided diff finds its BEFORE. */
  supersededByRequestId: string | null;
}

export function KpiVersionHistory({ versions }: { versions: KpiVersionRow[] }) {
  const t = useTranslations("pms.changeRequest");

  if (versions.length === 0) {
    return (
      <SectionCard title={t("historyTitle")} subtitle={t("historySubtitle")}>
        <EmptyState description={t("historyEmptyBody")} />
      </SectionCard>
    );
  }

  return (
    <SectionCard title={t("historyTitle")} subtitle={t("historySubtitle")}>
      <ol className="space-y-3">
        {versions.map((version) => (
          <li key={version.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">{version.kpiDescription}</p>
              <Badge variant="outline">{t("versionNo", { no: version.versionNo })}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{version.description}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("versionMeta", {
                weightage: version.weightage,
                datetime: formatDateTime(version.supersededAt),
              })}
            </p>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
