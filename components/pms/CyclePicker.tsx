"use client";

import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PerformanceCycle } from "@/components/pms/CycleList";

/**
 * The cycle selector every Phase 4-6 screen carries.
 *
 * Labelled with the year AND the status, because "2027" alone does not tell an
 * operator whether they are reading live figures or last year's archive — and on
 * a results screen that is the difference between a number they can act on and
 * one they cannot.
 */
export function CyclePicker({
  cycles,
  value,
  onChange,
  disabled,
}: {
  cycles: PerformanceCycle[];
  value: string | null;
  onChange: (cycleId: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("pms.cycles");
  const tCommon = useTranslations("pms.reports");

  if (cycles.length === 0) return null;

  return (
    <Select value={value ?? undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-56" aria-label={tCommon("selectCycle")}>
        <SelectValue placeholder={tCommon("selectCycle")} />
      </SelectTrigger>
      <SelectContent>
        {[...cycles]
          .sort((a, b) => b.year - a.year)
          .map((cycle) => (
            <SelectItem key={cycle.id} value={cycle.id}>
              {cycle.year} — {t(`statusValue.${cycle.status}`)}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}
