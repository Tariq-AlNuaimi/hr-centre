"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { stepForStage } from "@/lib/hiring/stage-rules";

/** Stage pill, fit-score chip and the Omanisation dot — Interview Hub StageTag / ScoreChip / NatTag. */

type Tone = "default" | "brand" | "success" | "warning" | "danger" | "info" | "outline";

/** One tone per spine step, so a column on the board and a pill in a list agree. */
const STEP_TONE: Record<number, Tone> = {
  1: "info",
  2: "info",
  3: "brand",
  4: "brand",
  5: "warning",
  6: "warning",
  7: "success",
};

export function StageBadge({ stage }: { stage: string }) {
  const t = useTranslations("hiring.stage");
  const tone: Tone =
    stage === "REJECTED"
      ? "danger"
      : stage === "WITHDRAWN"
        ? "outline"
        : (STEP_TONE[stepForStage(stage)] ?? "default");
  return <Badge variant={tone}>{t(stage)}</Badge>;
}

function scoreTone(v: number) {
  if (v >= 75) return "text-status-ok-fg";
  if (v >= 60) return "text-primary-emphasis";
  if (v >= 40) return "text-status-warn-fg";
  return "text-status-err-fg";
}

/** 0–100 fit; 0 / null reads as "not scored" (never as a failing score). */
export function ScoreChip({ value }: { value: number | null | undefined }) {
  const t = useTranslations("hiring.candidates");
  if (!value) {
    return (
      <span className="font-mono text-xs text-muted-foreground" title={t("notScored")}>
        —
      </span>
    );
  }
  const pct = Math.max(0, Math.min(100, value));
  return (
    <span
      className={cn("inline-flex items-center gap-1.5", scoreTone(value))}
      title={t("fitOf", { score: Math.round(value) })}
    >
      <span className="min-w-[2.2em] text-end font-mono text-sm font-bold">
        {Math.round(value)}
      </span>
      <span aria-hidden className="inline-block h-1.5 w-11 overflow-hidden rounded-full bg-muted">
        <span className="block h-full bg-current" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

/** Omani / expatriate marker (null = the reader may not see nationality). */
export function NationalityDot({ omani }: { omani: boolean | null }) {
  const t = useTranslations("hiring.candidates");
  if (omani === null) return null;
  return (
    <span
      role="img"
      aria-label={omani ? t("omani") : t("expat")}
      title={omani ? t("omani") : t("expat")}
      className={cn("inline-block h-2 w-2 rounded-full", omani ? "bg-status-ok-fg" : "bg-border")}
    />
  );
}
