"use client";

import { useTranslations } from "next-intl";
import { BarChart } from "@/components/shared/Chart";
import { bandShareRows, type Distribution } from "@/lib/pms/distribution";

/**
 * P2-1 — the calibration "curve": per band, the share of people actually there,
 * beside the target share and last cycle's share when they exist. Percentages,
 * so groups of different sizes (and years with different headcount) compare.
 *
 * The tiles next to it carry the exact counts; this chart is for SHAPE. The
 * figure's caption states the same comparison in words for anyone not reading
 * the bars (screen readers get the visible tiles and this caption).
 */
export function BandDistributionChart({
  counts,
  headcount,
  targetPct,
  prior,
  height = 260,
}: {
  counts: Record<string, number>;
  headcount: number;
  targetPct: Record<string, number> | null;
  prior: { year: number; counts: Record<string, number>; headcount: number } | null;
  height?: number;
}) {
  const t = useTranslations("pms.distributionChart");
  const tBand = useTranslations("pms.band");

  if (headcount === 0) return null;

  const rows = bandShareRows({
    actual: counts as Distribution,
    headcount,
    targetPct: targetPct as Distribution | null,
    prior: prior ? { actual: prior.counts as Distribution, headcount: prior.headcount } : null,
  }).map((r) => ({
    band: tBand(r.band),
    actual: r.actual,
    ...(r.target !== null ? { target: r.target } : {}),
    ...(r.prior !== null ? { prior: r.prior } : {}),
  }));

  const series = [
    { key: "actual", label: t("actual") },
    ...(targetPct ? [{ key: "target", label: t("target") }] : []),
    ...(prior ? [{ key: "prior", label: t("prior", { year: prior.year }) }] : []),
  ];

  return (
    <figure className="space-y-2">
      <BarChart data={rows} xKey="band" series={series} unit="%" height={height} />
      <figcaption className="text-xs text-muted-foreground">
        {targetPct
          ? t("captionWithTarget", { count: headcount })
          : t("caption", { count: headcount })}
      </figcaption>
    </figure>
  );
}
