"use client";

import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { RAIL_STEPS } from "@/lib/hiring/stage-rules";
import { cn } from "@/lib/utils";

/** The read-only eight-step spine under a screen's header (Interview Hub FlowStepper). */
export function FlowRail({ current }: { current: number }) {
  const t = useTranslations("hiring.steps");
  return (
    <ol aria-label={t("label")} className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs">
      {RAIL_STEPS.map((s) => (
        <li
          key={s}
          aria-current={s === current ? "step" : undefined}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-2.5 py-1",
            s === current
              ? "border-primary bg-accent-subtle font-semibold text-primary-emphasis"
              : s < current
                ? "border-border text-foreground"
                : "border-border text-muted-foreground",
          )}
        >
          {s < current ? <Check aria-hidden className="h-3 w-3" /> : null}
          {t(String(s))}
        </li>
      ))}
    </ol>
  );
}
