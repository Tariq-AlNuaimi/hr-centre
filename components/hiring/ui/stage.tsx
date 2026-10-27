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

/**
 * A candidate's stage as its PHASE first (Apply … Hire) with the stage itself
 * as the quieter second label — one vocabulary with the board (UX P1-7). When
 * both would read the same ("Hired" under Hire) only the phase shows.
 */
export function StageBadge({ stage }: { stage: string }) {
  const t = useTranslations("hiring.stage");
  const tStep = useTranslations("hiring.steps");
  if (stage === "REJECTED" || stage === "WITHDRAWN") {
    return <Badge variant={stage === "REJECTED" ? "danger" : "outline"}>{t(stage)}</Badge>;
  }
  const step = stepForStage(stage);
  if (!step) return <Badge variant="default">{t(stage)}</Badge>;
  const phase = tStep(String(step));
  const sub = t(stage);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Badge variant={STEP_TONE[step] ?? "default"}>{phase}</Badge>
      {samePhrase(phase, sub) ? null : (
        <span className="truncate text-xs text-muted-foreground">{sub}</span>
      )}
    </span>
  );
}

/** "Hire" and "Hired" say the same thing; "Offer" and "Offer extended" do not. */
function samePhrase(phase: string, stage: string): boolean {
  const a = phase.toLowerCase();
  const b = stage.toLowerCase();
  return b === a || b === `${a}d` || b === `${a}ed`;
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
