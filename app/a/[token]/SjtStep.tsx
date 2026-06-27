"use client";

import { Button } from "@/components/ui/button";
import type { CandidateLocale, CandidateStrings } from "@/lib/candidate-i18n";
import { useAutosave } from "./save";
import { SaveIndicator } from "./SaveIndicator";

type SjtItem = {
  id: string;
  scenario_en: string;
  scenario_ar: string | null;
  options: { id: string; text_en: string; text_ar: string | null }[];
};

// Step 2 — SJT (UI-SPEC C.3). One scenario per screen; options as single-select
// radio cards. Autosave each choice; same resume/error model as items. The
// "correct" option is NEVER revealed (the scoring key isn't even in the data).
export function SjtStep({
  t,
  locale,
  token,
  item,
  index,
  total,
  chosen,
  onChange,
  onBack,
  onNext,
}: {
  t: CandidateStrings;
  locale: CandidateLocale;
  token: string;
  item: SjtItem;
  index: number;
  total: number;
  chosen: string | null;
  onChange: (sjtItemId: string, chosenOptionId: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { save, retry, statusOf } = useAutosave(token);
  const scenario =
    locale === "ar" ? item.scenario_ar ?? item.scenario_en : item.scenario_en;
  const status = statusOf(item.id);

  const choose = (optionId: string) => {
    onChange(item.id, optionId);
    save(item.id, {
      kind: "sjt",
      sjtItemId: item.id,
      chosenOptionId: optionId,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t.sjtSectionTitle}
        </p>
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          {t.sectionOfN(index + 1, total)}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-accent">
          {t.scenarioHeading}
        </h2>
        <p className="mt-2 text-base leading-relaxed text-foreground">
          {scenario}
        </p>
      </div>

      <fieldset>
        <legend className="text-sm text-muted-foreground">{t.chooseOption}</legend>
        <div className="mt-3 flex flex-col gap-2" role="radiogroup" aria-label={scenario}>
          {item.options.map((o) => {
            const label = locale === "ar" ? o.text_ar ?? o.text_en : o.text_en;
            const selected = chosen === o.id;
            return (
              <label
                key={o.id}
                className={[
                  "flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
                  selected
                    ? "border-accent bg-[var(--rihal-mist)]"
                    : "border-border bg-card hover:border-accent/60",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name={`sjt-${item.id}`}
                  value={o.id}
                  checked={selected}
                  onChange={() => choose(o.id)}
                  className="mt-0.5 size-5 shrink-0 accent-[var(--rihal-azure)]"
                />
                <span className="text-sm leading-relaxed text-foreground">
                  {label}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex min-h-[1.25rem] justify-end">
        <SaveIndicator status={status} t={t} onRetry={() => retry(item.id)} />
      </div>

      {!chosen && (
        <p className="text-xs text-muted-foreground">{t.chooseOneHint}</p>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" onClick={onBack}>
          {t.back}
        </Button>
        <Button onClick={onNext} disabled={!chosen}>
          {t.next}
        </Button>
      </div>
    </div>
  );
}
