"use client";

import { useTranslations } from "next-intl";
import {
  Briefcase,
  CalendarDays,
  FileSignature,
  Percent,
  Timer,
  Trophy,
  Users,
} from "lucide-react";
import { BarChart } from "@/components/shared/Chart";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatCard } from "@/components/shared/StatCard";
import { useHiringQuery } from "../ui/api";
import { Notice, QueryState } from "../ui/states";
import { DeiCard, OmanizationCard, VelocityCard } from "./InsightCards";
import type { Insights } from "./types";

/**
 * `/hiring/insights` (Interview Hub `/insights`): KPI row, pipeline funnel,
 * time to hire by company, Omanization against target, and DEI (suppressed).
 * Everything is over the records the reader may see (D12).
 */
export function InsightsView() {
  const t = useTranslations("hiring.insights");
  const ts = useTranslations("hiring.stage");
  const q = useHiringQuery<Insights>("/api/hiring/insights");
  const d = q.data;
  const k = d?.kpis;
  const dash = (v: number | null | undefined, suffix: (n: number) => string) =>
    v === null || v === undefined ? "—" : suffix(v);
  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {d && k ? (
          <div className="space-y-4">
            {d.scoped ? <Notice>{t("scoped")}</Notice> : null}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                title={t("kOpen")}
                value={k.openRequisitions}
                icon={<Briefcase className="h-4 w-4" />}
              />
              <StatCard
                title={t("kActive")}
                value={k.activeCandidates}
                icon={<Users className="h-4 w-4" />}
              />
              <StatCard
                title={t("kInterviews")}
                value={k.upcomingInterviews}
                icon={<CalendarDays className="h-4 w-4" />}
              />
              <StatCard
                title={t("kOffers")}
                value={k.liveOffers}
                icon={<FileSignature className="h-4 w-4" />}
              />
              <StatCard title={t("kHires")} value={k.hires} icon={<Trophy className="h-4 w-4" />} />
              <StatCard
                title={t("kAcceptance")}
                value={dash(k.offerAcceptance, (n) => t("pct", { n }))}
                icon={<Percent className="h-4 w-4" />}
              />
              <StatCard
                title={t("kTimeToHire")}
                value={dash(k.avgDaysToHire, (n) => t("days", { n }))}
                icon={<Timer className="h-4 w-4" />}
              />
            </div>
            <SectionCard
              title={t("funnelTitle")}
              subtitle={t("funnelHint", {
                rejected: d.funnel.rejected,
                withdrawn: d.funnel.withdrawn,
              })}
            >
              {d.funnel.stages.every((s) => s.count === 0) ? (
                <p className="text-sm text-muted-foreground">{t("funnelEmpty")}</p>
              ) : (
                <BarChart
                  data={d.funnel.stages.map((s) => ({ stage: ts(s.stage), count: s.count }))}
                  xKey="stage"
                  yKey="count"
                  integer
                  height={300}
                />
              )}
            </SectionCard>
            <div className="grid gap-4 lg:grid-cols-2">
              <VelocityCard v={d.velocity} />
              {d.omanization ? <OmanizationCard o={d.omanization} /> : null}
            </div>
            {d.dei ? <DeiCard d={d.dei} /> : null}
          </div>
        ) : null}
      </QueryState>
    </div>
  );
}
