"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BarChart } from "@/components/shared/Chart";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatCard } from "@/components/shared/StatCard";
import { useSourceLabels, useStatusLabels } from "@/components/hive/escalations/status-labels";
import { apiClient } from "@/lib/api-client";
import { Link } from "@/i18n/navigation";
import { ServiceLevels, type ServiceLevelData } from "@/components/hive/reports/ServiceLevels";

/**
 * Blueprint US-T7: tiles, bars by HR pair / status / source, and volume over
 * time, for a date range. Counts only — the API returns no employee and no
 * question, so this screen could not show one if it tried.
 *
 * "Waiting on HR" and "Awaiting approval" are about today, not the range (a
 * backlog is a present fact), and say so in their hint line.
 */

interface Report {
  range: { from: string; to: string; bucket: "day" | "week" };
  tiles: {
    opened: number;
    waitingOnHr: number;
    awaitingApproval: number;
    answered: number;
    medianHoursToAnswer: number | null;
  };
  byStatus: { status: string; count: number }[];
  bySource: { source: string; count: number }[];
  byPair: { pairId: string; name: string; count: number }[];
  volume: { bucket: string; count: number }[];
  sla: ServiceLevelData["sla"];
  backlog: ServiceLevelData["backlog"];
  ageing: ServiceLevelData["ageing"];
  people: ServiceLevelData["people"];
  /** HR's label renames (Settings). */
  statusLabels: Record<string, string>;
}

const PRESETS = [7, 30, 90] as const;
type Preset = (typeof PRESETS)[number] | "custom";

/** A Muscat calendar day, `days` back from today, as `YYYY-MM-DD`. */
function muscatDay(daysBack: number): string {
  const d = new Date(Date.now() - daysBack * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Muscat" });
}

/**
 * A labelled bar list. Chosen over a chart for the categorical breakdowns:
 * HR pair names are long ("Siham Al Hadhrami & Alaa Al Hinai"), and a chart
 * axis either truncates or overlaps them. A list keeps every label readable,
 * reads naturally right-to-left, and is plain text to a screen reader.
 */
function Breakdown({
  rows,
  format,
}: {
  rows: { key: string; label: string; count: number; href?: Record<string, string> }[];
  format: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            {r.href ? (
              // P2-10 — click-through to the queue, filtered to these tickets.
              <Link
                href={{ pathname: "/tickets", query: r.href }}
                className="text-primary hover:underline"
              >
                {r.label}
              </Link>
            ) : (
              <span className="text-foreground">{r.label}</span>
            )}
            <span className="font-medium tabular-nums text-foreground">{format(r.count)}</span>
          </div>
          <div className="h-2 rounded-full bg-muted" aria-hidden>
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${(r.count / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function HiveReportsPage() {
  const t = useTranslations("hive.reports");
  const sourceLabel = useSourceLabels();
  const locale = useLocale();
  const [preset, setPreset] = useState<Preset>(30);
  const [custom, setCustom] = useState({ from: muscatDay(29), to: muscatDay(0) });

  const range = preset === "custom" ? custom : { from: muscatDay(preset - 1), to: muscatDay(0) };
  const customInvalid =
    preset === "custom" && (!custom.from || !custom.to || custom.from > custom.to);

  const query = useQuery<Report>({
    queryKey: ["hive", "reports", range.from, range.to],
    enabled: !customInvalid,
    queryFn: () =>
      apiClient.get<Report>(
        `/api/hive/admin/reports?${new URLSearchParams({ from: range.from, to: range.to })}`,
      ),
  });

  const number = new Intl.NumberFormat(locale);
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(
      new Date(`${iso}T00:00:00Z`),
    );

  function duration(hours: number | null): string {
    if (hours === null) return "—";
    if (hours < 1) return t("underAnHour");
    if (hours < 48) return t("hours", { n: number.format(Math.round(hours)) });
    return t("days", { n: number.format(Math.round(hours / 24)) });
  }

  const report = query.data;
  const statusLabel = useStatusLabels(report?.statusLabels);
  const series = t("tickets");

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("intro")} />

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("rangeLabel")}>
          {PRESETS.map((p) => (
            <Button
              key={p}
              size="sm"
              variant={preset === p ? "default" : "outline"}
              onClick={() => setPreset(p)}
            >
              {t("lastDays", { n: p })}
            </Button>
          ))}
          <Button
            size="sm"
            variant={preset === "custom" ? "default" : "outline"}
            onClick={() => setPreset("custom")}
          >
            {t("custom")}
          </Button>
        </div>
        {preset === "custom" ? (
          <>
            <div className="flex flex-col gap-1">
              <Label htmlFor="report-from">{t("from")}</Label>
              <Input
                id="report-from"
                type="date"
                className="w-40"
                value={custom.from}
                max={custom.to || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="report-to">{t("to")}</Label>
              <Input
                id="report-to"
                type="date"
                className="w-40"
                value={custom.to}
                min={custom.from || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              />
            </div>
          </>
        ) : null}
        {!customInvalid ? (
          // P2-10 — the same range as CSV (service-level columns only, no names or questions).
          <a
            className="ms-auto text-sm text-primary hover:underline"
            href={`/api/hive/admin/reports/export?${new URLSearchParams({ from: range.from, to: range.to })}`}
            download
          >
            {t("exportCsv")}
          </a>
        ) : null}
      </div>

      {customInvalid ? (
        <EmptyState description={t("badRange")} />
      ) : query.isError ? (
        <EmptyState
          description={query.error instanceof Error ? query.error.message : t("loadFailed")}
        />
      ) : !report ? (
        <EmptyState description={t("loading")} />
      ) : (
        <div className="flex flex-col gap-6" aria-busy={query.isFetching}>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard
              title={t("opened")}
              value={number.format(report.tiles.opened)}
              hint={t("inRange")}
            />
            <StatCard
              title={t("waitingOnHr")}
              value={number.format(report.tiles.waitingOnHr)}
              hint={t("rightNow")}
            />
            <StatCard
              title={t("awaitingApproval")}
              value={number.format(report.tiles.awaitingApproval)}
              hint={t("rightNow")}
            />
            <StatCard
              title={t("answered")}
              value={number.format(report.tiles.answered)}
              hint={t("inRange")}
            />
            <StatCard
              title={t("medianToAnswer")}
              value={duration(report.tiles.medianHoursToAnswer)}
              hint={t("medianHint")}
            />
          </div>

          {report.tiles.opened === 0 ? (
            <EmptyState description={t("empty")} />
          ) : (
            <>
              <SectionCard
                title={t("volume")}
                subtitle={report.range.bucket === "week" ? t("perWeek") : t("perDay")}
              >
                {/* Bars, not a line: these are counts per bucket, and a smoothed
                    line draws values between days that never happened. The
                    series key IS the label, so the legend and tooltip say
                    "Tickets" rather than an axis name. */}
                <BarChart
                  data={report.volume.map((v) => ({ x: day(v.bucket), [series]: v.count }))}
                  yKey={series}
                  integer
                  height={260}
                />
              </SectionCard>
              <ServiceLevels data={report} duration={duration} day={day} number={number} />
              <div className="grid gap-6 lg:grid-cols-3">
                <SectionCard title={t("byPair")}>
                  <Breakdown
                    rows={report.byPair.map((p) => ({
                      key: p.pairId,
                      label: p.name,
                      count: p.count,
                      href: { pairId: p.pairId, from: report.range.from, to: report.range.to },
                    }))}
                    format={number.format}
                  />
                </SectionCard>
                <SectionCard title={t("byStatus")} subtitle={t("byStatusHint")}>
                  <Breakdown
                    rows={report.byStatus.map((s) => ({
                      key: s.status,
                      label: statusLabel[s.status] ?? s.status,
                      count: s.count,
                      href: { status: s.status, from: report.range.from, to: report.range.to },
                    }))}
                    format={number.format}
                  />
                </SectionCard>
                <SectionCard title={t("bySource")}>
                  <Breakdown
                    rows={report.bySource.map((s) => ({
                      key: s.source,
                      label: sourceLabel[s.source] ?? s.source,
                      count: s.count,
                    }))}
                    format={number.format}
                  />
                </SectionCard>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
