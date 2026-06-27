"use client";

import { Button } from "@/components/ui/button";
import type { CandidateLocale, CandidateStrings } from "@/lib/candidate-i18n";
import { useAutosave } from "./save";
import { SaveIndicator } from "./SaveIndicator";

type Item = { itemNumber: number; text_en: string; text_ar: string | null };

// Step 1 — Personality items (UI-SPEC C.2). 5 items per screen, each a 5-point
// Likert as a native radio group with 44px targets + a fieldset/legend label.
// Autosave on change (optimistic + inline retry). Next is disabled until all 5
// on the screen are answered. The Likert order mirrors in RTL via flex + dir.
export function ItemsStep({
  t,
  locale,
  token,
  items,
  itemsPerScreen,
  screen,
  totalScreens,
  values,
  onChange,
  onBack,
  canGoBack,
  onNext,
}: {
  t: CandidateStrings;
  locale: CandidateLocale;
  token: string;
  items: Item[];
  itemsPerScreen: number;
  screen: number;
  totalScreens: number;
  values: Map<number, number>;
  onChange: (itemNumber: number, value: number) => void;
  onBack: () => void;
  canGoBack: boolean;
  onNext: () => void;
}) {
  const { save, retry, statusOf } = useAutosave(token);

  const slice = items.slice(
    screen * itemsPerScreen,
    screen * itemsPerScreen + itemsPerScreen
  );
  const allAnswered = slice.every((it) => values.has(it.itemNumber));

  const likert = [
    { value: 1, label: t.likertVeryInaccurate },
    { value: 2, label: t.likertInaccurate },
    { value: 3, label: t.likertNeutral },
    { value: 4, label: t.likertAccurate },
    { value: 5, label: t.likertVeryAccurate },
  ];

  const choose = (itemNumber: number, value: number) => {
    onChange(itemNumber, value);
    save(String(itemNumber), { kind: "item", itemNumber, value });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t.itemsSectionTitle}
        </p>
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          {t.sectionOfN(screen + 1, totalScreens)}
        </p>
      </div>

      <ol className="flex flex-col gap-4">
        {slice.map((it) => {
          const text =
            locale === "ar" ? it.text_ar ?? it.text_en : it.text_en;
          const current = values.get(it.itemNumber);
          const key = String(it.itemNumber);
          const status = statusOf(key);
          return (
            <li key={it.itemNumber}>
              <fieldset className="rounded-lg border border-border bg-card p-5 shadow-[var(--shadow-card)]">
                <div className="flex items-start justify-between gap-3">
                  <legend className="text-base font-medium leading-relaxed text-foreground">
                    {text}
                  </legend>
                </div>
                <div
                  className="mt-4 grid grid-cols-5 gap-1.5"
                  role="radiogroup"
                  aria-label={text}
                >
                  {likert.map((opt) => {
                    const selected = current === opt.value;
                    return (
                      <label
                        key={opt.value}
                        className={[
                          "flex min-h-[44px] cursor-pointer flex-col items-center justify-center gap-1 rounded-md border px-1 py-2 text-center transition-colors",
                          selected
                            ? "border-accent bg-secondary text-foreground"
                            : "border-border bg-background text-muted-foreground hover:border-accent/60",
                        ].join(" ")}
                      >
                        <input
                          type="radio"
                          name={`item-${it.itemNumber}`}
                          value={opt.value}
                          checked={selected}
                          onChange={() => choose(it.itemNumber, opt.value)}
                          className="size-4 accent-[var(--rihal-azure)]"
                        />
                        <span className="text-[11px] leading-tight">
                          {opt.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="mt-2 flex min-h-[1.25rem] justify-end">
                  <SaveIndicator
                    status={status}
                    t={t}
                    onRetry={() => retry(key)}
                  />
                </div>
              </fieldset>
            </li>
          );
        })}
      </ol>

      {!allAnswered && (
        <p className="text-xs text-muted-foreground">{t.answerAllHint}</p>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={!canGoBack}
        >
          {t.back}
        </Button>
        <Button onClick={onNext} disabled={!allAnswered}>
          {t.next}
        </Button>
      </div>
    </div>
  );
}
