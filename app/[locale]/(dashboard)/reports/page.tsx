"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageSkeleton, TableSkeleton } from "@/components/shared/Skeletons";
import { Button } from "@/components/ui/button";
import { CyclePicker } from "@/components/pms/CyclePicker";
import { BonusReport } from "@/components/pms/BonusReport";
import { CycleProgressReport } from "@/components/pms/CycleProgressReport";
import { DistributionReport } from "@/components/pms/DistributionReport";
import { ManagerComplianceReport } from "@/components/pms/ManagerComplianceReport";
import { MasterResultsExport } from "@/components/pms/MasterResultsExport";
import { useCycleSelection } from "@/hooks/use-cycle-selection";
import { usePmsActor } from "@/hooks/use-pms-actor";

/**
 * §13.5 — HR's five reports, on one screen.
 *
 * The clause lists five, and they are five tabs rather than five nav items for a
 * reason: they are all read against ONE cycle, and an HR person comparing the
 * band distribution against the compliance picture should not have to re-choose
 * the year in between. The cycle picker sits above the tabs and belongs to all
 * of them.
 *
 * ## Two of the five are gated more tightly than the page
 *
 * The page needs org-wide sight (HR + the executive viewers). Within it:
 *
 *   - the bonus report needs `viewCompensation` (§11.6);
 *   - the master results export is HR Super Admin ONLY (§13.5 — "not HRBP").
 *
 * Tabs the actor cannot use are not rendered at all rather than rendered
 * disabled: a disabled tab labelled "Master results" tells an HRBP that a report
 * exists which they are not trusted with, which is information the clause has no
 * reason to give them. Both routes enforce it regardless.
 */

const TABS = [
  { key: "progress", requires: "orgWide" },
  { key: "compliance", requires: "orgWide" },
  { key: "distribution", requires: "orgWide" },
  { key: "bonus", requires: "viewCompensation" },
  { key: "master", requires: "exportMasterResults" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function ReportsPage() {
  const t = useTranslations("pms.reports");
  const { capabilities, isLoading: actorLoading } = usePmsActor();
  const { cycles, cycleList, cycleId, selectedCycleId, setSelectedCycleId } = useCycleSelection();
  const [tab, setTab] = useState<TabKey>("progress");

  if (actorLoading || cycles.isLoading) return <PageSkeleton />;

  if (!capabilities.orgWide) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <SectionCard title={t("notPermitted")}>
          <EmptyState description={t("notPermittedHelp")} />
        </SectionCard>
      </div>
    );
  }

  const visible = TABS.filter((tabDef) => capabilities[tabDef.requires]);
  const active = visible.some((v) => v.key === tab) ? tab : (visible[0]?.key ?? "progress");

  if (cycleList.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <SectionCard title={t("noCycles")}>
          <EmptyState description={t("noCyclesHelp")} />
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <CyclePicker
            cycles={cycleList}
            value={selectedCycleId ?? cycleId}
            onChange={setSelectedCycleId}
          />
        }
      />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("title")}>
        {visible.map((tabDef) => (
          <Button
            key={tabDef.key}
            role="tab"
            aria-selected={active === tabDef.key}
            variant={active === tabDef.key ? "default" : "outline"}
            size="sm"
            onClick={() => setTab(tabDef.key)}
          >
            {t(`tab.${tabDef.key}`)}
          </Button>
        ))}
      </div>

      {cycleId === null ? (
        <TableSkeleton />
      ) : (
        <div role="tabpanel">
          {active === "progress" && <CycleProgressReport cycleId={cycleId} />}
          {active === "compliance" && <ManagerComplianceReport cycleId={cycleId} />}
          {active === "distribution" && <DistributionReport cycleId={cycleId} />}
          {active === "bonus" && <BonusReport cycleId={cycleId} />}
          {active === "master" && <MasterResultsExport cycleId={cycleId} />}
        </div>
      )}
    </div>
  );
}
