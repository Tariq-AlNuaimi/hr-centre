"use client";

import * as React from "react";
import {
  candidateStrings,
  type CandidateLocale,
  type CandidateStrings,
} from "@/lib/candidate-i18n";
import { Button } from "@/components/ui/button";
import { JourneyLine } from "./JourneyLine";
import { ConsentStep } from "./ConsentStep";
import { ItemsStep } from "./ItemsStep";
import { SjtStep } from "./SjtStep";
import { CompletionStep } from "./CompletionStep";

export type RunnerData = {
  token: string;
  roleTitle: string;
  initialLocale: CandidateLocale;
  consented: boolean;
  items: { itemNumber: number; text_en: string; text_ar: string | null }[];
  sjt: {
    id: string;
    scenario_en: string;
    scenario_ar: string | null;
    options: { id: string; text_en: string; text_ar: string | null }[];
  }[];
  savedItems: { itemNumber: number; value: number }[];
  savedSjt: { sjtItemId: string; chosenOptionId: string }[];
  itemsPerScreen: number;
};

// The flow phases. "consent" → "items" → ("sjt") → "done". The numeric screen
// index within items/sjt is held alongside.
type Phase = "consent" | "items" | "sjt" | "done";

export function Runner({ data }: { data: RunnerData }) {
  const [locale, setLocale] = React.useState<CandidateLocale>(data.initialLocale);
  const t: CandidateStrings = candidateStrings[locale];
  const dir = locale === "ar" ? "rtl" : "ltr";

  // Keep <html lang|dir> in sync so the page chrome (scrollbars, font swap, native
  // controls) mirrors, while the in-page <div dir> drives the layout (C.5).
  React.useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  // OPENED beacon (UI-SPEC D.5 status tracking). Fire once on mount so HR sees the
  // link was viewed; idempotent server-side (only flips PENDING → OPENED). Skip
  // when the candidate already consented (they're past "opened"). Fire-and-forget:
  // a failed beacon must never block the assessment.
  React.useEffect(() => {
    if (data.consented) return;
    void fetch(`/api/run/${data.token}/opened`, { method: "POST" }).catch(() => {});
    // Once on mount only — status, not a reactive value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Answer state (survives the EN/AR toggle: it's plain React state) ----
  const [itemValues, setItemValues] = React.useState<Map<number, number>>(
    () => new Map(data.savedItems.map((r) => [r.itemNumber, r.value]))
  );
  const [sjtValues, setSjtValues] = React.useState<Map<string, string>>(
    () => new Map(data.savedSjt.map((r) => [r.sjtItemId, r.chosenOptionId]))
  );

  const hasSjt = data.sjt.length > 0;
  const totalItemScreens = Math.ceil(data.items.length / data.itemsPerScreen);

  // ---- Resume: pick the starting phase/screen from saved answers (C.2) ----
  const firstUnansweredItemScreen = React.useMemo(() => {
    for (let screen = 0; screen < totalItemScreens; screen++) {
      const slice = data.items.slice(
        screen * data.itemsPerScreen,
        screen * data.itemsPerScreen + data.itemsPerScreen
      );
      if (slice.some((it) => !itemValues.has(it.itemNumber))) return screen;
    }
    return totalItemScreens; // all items answered
    // Intentionally compute once on mount (resume target); later edits don't move us.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const firstUnansweredSjtScreen = React.useMemo(() => {
    for (let i = 0; i < data.sjt.length; i++) {
      if (!sjtValues.has(data.sjt[i].id)) return i;
    }
    return data.sjt.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialPhase = React.useMemo<{ phase: Phase; screen: number }>(() => {
    if (!data.consented) return { phase: "consent", screen: 0 };
    if (firstUnansweredItemScreen < totalItemScreens) {
      return { phase: "items", screen: firstUnansweredItemScreen };
    }
    if (hasSjt && firstUnansweredSjtScreen < data.sjt.length) {
      return { phase: "sjt", screen: firstUnansweredSjtScreen };
    }
    // Everything answered on resume → land on the last screen (they can submit).
    return hasSjt
      ? { phase: "sjt", screen: Math.max(0, data.sjt.length - 1) }
      : { phase: "items", screen: Math.max(0, totalItemScreens - 1) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [phase, setPhase] = React.useState<Phase>(initialPhase.phase);
  const [screen, setScreen] = React.useState<number>(initialPhase.screen);

  // ---- Progress across the WHOLE flow (consent + items + sjt + done) ----
  const totalScreens = 1 + totalItemScreens + (hasSjt ? data.sjt.length : 0) + 1;
  const completedScreens = (() => {
    if (phase === "consent") return 0;
    if (phase === "items") return 1 + screen;
    if (phase === "sjt") return 1 + totalItemScreens + screen;
    return totalScreens; // done
  })();
  const percent =
    phase === "done"
      ? 100
      : Math.round((completedScreens / (totalScreens - 1)) * 100);

  const toggleLocale = () =>
    setLocale((l) => (l === "en" ? "ar" : "en"));

  // ---- Navigation between phases ----
  const goAfterConsent = () => {
    setPhase("items");
    setScreen(0);
  };
  const itemsNext = () => {
    if (screen + 1 < totalItemScreens) {
      setScreen(screen + 1);
    } else if (hasSjt) {
      setPhase("sjt");
      setScreen(0);
    } else {
      setPhase("done");
    }
  };
  const itemsBack = () => {
    if (screen > 0) setScreen(screen - 1);
    else if (data.consented) {
      /* consent skipped on resume — nowhere to go back to */
    } else {
      setPhase("consent");
    }
  };
  const sjtNext = () => {
    if (screen + 1 < data.sjt.length) setScreen(screen + 1);
    else setPhase("done");
  };
  const sjtBack = () => {
    if (screen > 0) setScreen(screen - 1);
    else {
      setPhase("items");
      setScreen(totalItemScreens - 1);
    }
  };

  return (
    <div dir={dir} className="min-h-screen bg-background text-foreground">
      {/* Persistent top bar: wordmark + journey line + EN/AR toggle */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto w-full max-w-[680px] px-5">
          <div className="flex h-14 items-center justify-between gap-3">
            <span className="font-display text-sm font-semibold tracking-tight text-primary dark:text-accent-ink">
              {t.wordmark}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLocale}
              aria-label={t.langToggle}
              lang={locale === "en" ? "ar" : "en"}
            >
              {t.switchToOtherLang}
            </Button>
          </div>
          <div className="pb-3">
            <JourneyLine percent={percent} label={t.progressLabel} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[680px] px-5 py-8">
        {phase === "consent" && (
          <ConsentStep
            t={t}
            locale={locale}
            token={data.token}
            roleTitle={data.roleTitle}
            onConsented={goAfterConsent}
          />
        )}

        {phase === "items" && (
          <ItemsStep
            t={t}
            locale={locale}
            token={data.token}
            items={data.items}
            itemsPerScreen={data.itemsPerScreen}
            screen={screen}
            totalScreens={totalItemScreens}
            values={itemValues}
            onChange={(itemNumber, value) =>
              setItemValues((m) => new Map(m).set(itemNumber, value))
            }
            onBack={itemsBack}
            canGoBack={!(screen === 0 && data.consented)}
            onNext={itemsNext}
          />
        )}

        {phase === "sjt" && hasSjt && (
          <SjtStep
            t={t}
            locale={locale}
            token={data.token}
            item={data.sjt[screen]}
            index={screen}
            total={data.sjt.length}
            chosen={sjtValues.get(data.sjt[screen].id) ?? null}
            onChange={(sjtItemId, chosenOptionId) =>
              setSjtValues((m) => new Map(m).set(sjtItemId, chosenOptionId))
            }
            onBack={sjtBack}
            onNext={sjtNext}
          />
        )}

        {phase === "done" && (
          <CompletionStep t={t} token={data.token} />
        )}
      </main>
    </div>
  );
}
