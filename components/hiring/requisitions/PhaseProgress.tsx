"use client";

import { useTranslations } from "next-intl";
import { BOARD_STEPS } from "@/lib/hiring/stage-rules";
import { cn } from "@/lib/utils";

const FILL: Record<number, string> = {
  1: "bg-status-info-fg",
  2: "bg-status-info-fg/70",
  3: "bg-primary",
  4: "bg-primary/70",
  5: "bg-status-warn-fg",
  6: "bg-status-warn-fg/70",
  7: "bg-status-ok-fg",
};

/**
 * A requisition's candidates per phase as ONE bar with counts (UX P1-7) — a
 * distribution, deliberately unlike the candidate stepper, which is a position.
 */
export function PhaseProgress({ steps }: { steps: number[] }) {
  const t = useTranslations("hiring.steps");
  const tr = useTranslations("hiring.reqPipeline");
  const counts = BOARD_STEPS.map((s) => ({ step: s, n: steps.filter((x) => x === s).length }));
  const total = steps.length;
  return (
    <figure className="space-y-2" aria-label={tr("progressLabel", { count: total })}>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        {total
          ? counts
              .filter((c) => c.n > 0)
              .map((c) => (
                <span
                  key={c.step}
                  className={cn("h-full", FILL[c.step])}
                  style={{ width: `${(c.n / total) * 100}%` }}
                />
              ))
          : null}
      </div>
      <ol className="grid grid-cols-4 gap-x-3 gap-y-1 text-xs sm:grid-cols-7">
        {counts.map((c) => (
          <li key={c.step} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("h-2 w-2 rounded-sm", FILL[c.step])} />
            <span className={c.n ? "text-foreground" : "text-muted-foreground"}>
              {t(String(c.step))}
            </span>
            <span className="font-mono font-semibold text-foreground">{c.n}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
