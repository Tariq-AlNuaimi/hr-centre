"use client";

import { useTranslations } from "next-intl";
import { CalendarClock, Lock, TriangleAlert } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";

/**
 * The goal-setting stage window — spec §2 (HR sets each stage's deadline) and
 * §5.4 (a deadline is a HARD LOCK).
 *
 * Two things this banner exists to make impossible:
 *
 *   1. **A silent lock.** §5.4 stops the relevant party acting the moment the
 *      deadline passes. A screen that discovers that only when a save comes back
 *      409 has already wasted the manager's evening. The state is stated up
 *      front, in the same words the write route would use.
 *   2. **A date without its time.** "31 December" is not an instant, and the
 *      stage locks at one. Every date here carries its time for that reason —
 *      the same decision CycleList made for HR's own console.
 *
 * `state` is computed by the SERVER (`stageState`, lib/pms/cycle.ts) and passed
 * in, never recomputed from `Date.now()` here: a client clock that runs a minute
 * fast would render a lock the server does not agree with.
 */

export type StageState = "NOT_YET_OPEN" | "OPEN" | "LOCKED";

export interface GoalStage {
  /** ISO instant the stage opens at. */
  opensAt: string;
  /** ISO instant the stage locks at (§5.4). */
  deadline: string;
  /** Days after the deadline in which HR may still intervene (§5.5). */
  graceDays: number;
  state: StageState;
}

const STATE_TONE: Record<StageState, BadgeProps["variant"]> = {
  NOT_YET_OPEN: "outline",
  OPEN: "success",
  LOCKED: "warning",
};

interface StageBannerProps {
  /** Null when the cycle has no stage of this kind configured yet (§2). */
  stage: GoalStage | null;
  /**
   * Which stage's copy to render. §2 runs three touchpoints through the same
   * §5.4 lock, so the BEHAVIOUR is identical and only the wording differs —
   * "nothing can be drafted or signed" is wrong for §6's mid-year window, where
   * what closes is the ability to raise a change request. A namespace prop keeps
   * one banner rather than forking a second that would drift.
   */
  namespace?: "pms.goalSetting.stage" | "pms.midYear.stage";
}

export function StageBanner({ stage, namespace = "pms.goalSetting.stage" }: StageBannerProps) {
  const t = useTranslations(namespace);

  if (!stage) {
    return (
      <div className="flex items-start gap-3 rounded-md border border-border bg-card p-4">
        <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("notConfigured")}</p>
      </div>
    );
  }

  const locked = stage.state === "LOCKED";
  const Icon = locked ? Lock : CalendarClock;

  const headline = locked
    ? t("locked", { datetime: formatDateTime(stage.deadline) })
    : stage.state === "NOT_YET_OPEN"
      ? t("notYetOpen", { datetime: formatDateTime(stage.opensAt) })
      : t("open", { datetime: formatDateTime(stage.deadline) });

  const body = locked
    ? t("lockedBody")
    : stage.state === "NOT_YET_OPEN"
      ? t("notYetOpenBody")
      : t("graceNote", { days: stage.graceDays });

  return (
    // `role="status"` rather than `role="alert"`: this is the standing state of
    // the stage on page load, not an error that just happened. The failure of an
    // individual write is what gets `role="alert"`, in the board below.
    <div
      role="status"
      className="flex flex-wrap items-start gap-3 rounded-md border border-border bg-card p-4"
    >
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{t("title")}</span>
          <Badge variant={STATE_TONE[stage.state]}>{t(`stateValue.${stage.state}`)}</Badge>
          <span className="text-sm text-muted-foreground">{headline}</span>
        </div>
        <p className="text-xs text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
