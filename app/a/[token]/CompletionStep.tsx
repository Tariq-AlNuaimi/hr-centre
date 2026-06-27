"use client";

import * as React from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CandidateStrings } from "@/lib/candidate-i18n";
import { postSubmit } from "./save";

// Step 3 — Completion (UI-SPEC C.4). On mount, POST submit (the journey line is
// already at 100% via the Runner). Honest states: submitting / submitted /
// failed-with-retry. No score is shown; on failure, responses are reassured safe.
type SubmitState = "submitting" | "done" | "error";

export function CompletionStep({
  t,
  token,
}: {
  t: CandidateStrings;
  token: string;
}) {
  const [state, setState] = React.useState<SubmitState>("submitting");
  const startedRef = React.useRef(false);

  const submit = React.useCallback(async () => {
    setState("submitting");
    try {
      await postSubmit(token);
      setState("done");
    } catch {
      setState("error");
    }
  }, [token]);

  React.useEffect(() => {
    if (startedRef.current) return; // submit exactly once on mount
    startedRef.current = true;
    void submit();
  }, [submit]);

  if (state === "submitting") {
    return (
      <div
        className="flex flex-col items-center gap-4 py-16 text-center"
        aria-live="polite"
      >
        <Loader2 aria-hidden className="size-8 animate-spin text-accent" />
        <p className="text-sm text-muted-foreground">{t.submitting}</p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex flex-col gap-4 py-8" aria-live="assertive">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {t.submitFailedTitle}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t.submitFailed}
        </p>
        <p className="text-sm font-medium text-foreground">{t.responsesSafe}</p>
        <div>
          <Button onClick={() => void submit()}>{t.submitRetry}</Button>
        </div>
      </div>
    );
  }

  // done
  return (
    <div
      className="flex flex-col items-center gap-5 py-12 text-center"
      aria-live="polite"
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-secondary">
        <CheckCircle2 aria-hidden className="size-8 text-[var(--signal-pass-ink)]" />
      </span>
      <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight text-foreground">
        {t.completionTitle}
      </h1>
      <p className="max-w-[48ch] text-sm leading-relaxed text-muted-foreground">
        {t.completionBody}
      </p>
      <div className="mt-2 w-full max-w-[48ch] rounded-lg border border-border bg-card p-5 text-start shadow-[var(--shadow-card)]">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t.whatHappensNextTitle}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t.whatHappensNext}
        </p>
      </div>
    </div>
  );
}
