"use client";

import * as React from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Loader2, RefreshCw, BarChart3, Info } from "lucide-react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FitScatter } from "./FitScatter";
import type { CalibrationReport, CompetencySignal } from "@/lib/calibration";
import type { RoleCalibrationStatus } from "@/lib/services/calibration";

type StoredReport = { report: CalibrationReport; sampleSize: number; version: number; generatedAt: string } | null;

// Calibration report panel (UI-SPEC D.9). Reads are RSC — the server passes the
// selected role's latest persisted report; this island only navigates the role
// selector and triggers (re)generation, then refreshes. Honest states: an
// under-populated role shows "needs N more", a never-generated role prompts a first
// run, and a real report renders the predicted-vs-observed scatter + per-competency
// signal with ADVISORY suggestions (never auto-applied).
export function CalibrationReportPanel({
  roles,
  selectedRoleId,
  stored,
}: {
  roles: RoleCalibrationStatus[];
  selectedRoleId: string | null;
  stored: StoredReport;
}) {
  const t = useTranslations("calibration");
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();

  const [generating, setGenerating] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  if (roles.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noRoles")}</p>;
  }

  const selected = selectedRoleId ?? roles[0].roleProfileId;

  function selectRole(id: string) {
    setNotice(null);
    router.push(`${pathname}?role=${id}`);
  }

  async function generate() {
    setNotice(null);
    setGenerating(true);
    try {
      const res = await fetch(`/api/calibration/${selected}/generate`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        // 409 = honest insufficient/typed state — surface the message, not an error tone.
        setNotice(body.error ?? t("saveError"));
        setGenerating(false);
        return;
      }
      setGenerating(false);
      router.refresh();
    } catch {
      setNotice(t("saveError"));
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <label htmlFor="calib-role" className="text-sm text-muted-foreground">
            {t("roleSelect")}
          </label>
          <Select id="calib-role" value={selected} onChange={(e) => selectRole(e.target.value)}>
            {roles.map((r) => (
              <option key={r.roleProfileId} value={r.roleProfileId}>
                {t("roleOption", {
                  family: r.roleFamily,
                  title: r.roleTitle,
                  version: r.version,
                  count: r.outcomeCount,
                })}
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={generate} disabled={generating}>
          {generating ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {generating ? t("generating") : stored ? t("regenerate") : t("generate")}
        </Button>
      </div>

      {notice && (
        <p role="status" className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm text-[var(--signal-partial-ink)]">
          {notice}
        </p>
      )}

      {stored ? (
        <ReportBody stored={stored} t={t} formatDate={(d) => format.dateTime(new Date(d), { year: "numeric", month: "short", day: "numeric" })} />
      ) : (
        !notice && (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-6 py-10 text-center">
            <BarChart3 aria-hidden className="size-6 text-muted-foreground" />
            <p className="max-w-md text-sm text-muted-foreground">{t("neverGenerated")}</p>
          </div>
        )
      )}
    </div>
  );
}

function ReportBody({
  stored,
  t,
  formatDate,
}: {
  stored: NonNullable<StoredReport>;
  t: ReturnType<typeof useTranslations>;
  formatDate: (d: string) => string;
}) {
  const { report } = stored;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-muted-foreground">
        {t("lastGenerated", { date: formatDate(stored.generatedAt), n: stored.sampleSize, version: stored.version })}
      </p>

      {/* Predicted fit vs observed success */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-sm font-semibold text-foreground">{t("fitChartTitle")}</h3>
          <span className="tabular-nums text-xs text-muted-foreground">
            {t("fitCorrelation", { r: report.fit.r.toFixed(2) })}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{t("fitChartSubtitle")}</p>
        <FitScatter
          points={report.fit.points}
          fitLabel={t("axisFit")}
          successLabel={t("axisSuccess")}
          ariaLabel={`${t("fitChartTitle")} — ${t("fitCorrelation", { r: report.fit.r.toFixed(2) })}`}
        />
      </section>

      {/* Per-competency signal */}
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="font-display text-sm font-semibold text-foreground">{t("signalTitle")}</h3>
          <p className="text-xs text-muted-foreground">{t("signalSubtitle")}</p>
        </div>
        <div className="flex flex-col gap-2">
          {report.competencies.map((c) => (
            <SignalRow key={c.name} c={c} t={t} />
          ))}
        </div>
      </section>

      <p className="flex items-start gap-2 rounded-md border-s-2 border-[var(--rihal-sand)] bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-[var(--rihal-sand)]" />
        {t("advisoryNote")}
      </p>
    </div>
  );
}

const SUGGESTION: Record<
  CompetencySignal["suggestion"],
  { key: string; variant: "pass" | "partial" | "below" | "muted" }
> = {
  hold: { key: "suggestHold", variant: "pass" },
  raise: { key: "suggestRaise", variant: "partial" },
  lower: { key: "suggestLower", variant: "below" },
  insufficient: { key: "suggestInsufficient", variant: "muted" },
};

function SignalRow({ c, t }: { c: CompetencySignal; t: ReturnType<typeof useTranslations> }) {
  const sug = SUGGESTION[c.suggestion];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border px-3 py-2.5">
      <span className="flex-1 text-sm font-medium text-foreground">{c.name}</span>
      <span className="tabular-nums text-xs text-muted-foreground">{t("signalR", { r: c.r.toFixed(2) })}</span>
      {c.meanSuccessPass !== null && (
        <span className="tabular-nums text-xs text-[var(--signal-pass-ink)]">
          {t("signalPass", { pct: `${Math.round(c.meanSuccessPass * 100)}%` })}
        </span>
      )}
      {c.meanSuccessBelow !== null && (
        <span className="tabular-nums text-xs text-[var(--signal-below-ink)]">
          {t("signalBelow", { pct: `${Math.round(c.meanSuccessBelow * 100)}%` })}
        </span>
      )}
      <span className="tabular-nums text-xs text-muted-foreground">{t("signalSampleN", { n: c.n })}</span>
      {sug.variant === "muted" ? (
        <Badge variant="outline">{t(sug.key)}</Badge>
      ) : (
        <Badge variant={sug.variant}>{t(sug.key)}</Badge>
      )}
    </div>
  );
}
