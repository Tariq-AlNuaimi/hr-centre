"use client";

import { Check, RotateCw } from "lucide-react";
import type { SaveStatus } from "./save";
import type { CandidateStrings } from "@/lib/candidate-i18n";

// The subtle per-answer save indicator (UI-SPEC C.2): "Saving…" → "Saved", or an
// inline "Couldn't save — Retry" that never loses the answer. Honest feedback:
// the error variant is the only one that asks for action; success is quiet.
export function SaveIndicator({
  status,
  t,
  onRetry,
}: {
  status: SaveStatus;
  t: CandidateStrings;
  onRetry: () => void;
}) {
  if (status === "idle") return null;

  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-destructive">
        <span>{t.saveFailed}</span>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded-sm font-medium underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCw aria-hidden className="size-3" />
          {t.retry}
        </button>
      </span>
    );
  }

  if (status === "saving") {
    return (
      <span className="text-xs text-muted-foreground" aria-live="polite">
        {t.saving}
      </span>
    );
  }

  // saved
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      aria-live="polite"
    >
      <Check aria-hidden className="size-3 text-[var(--signal-pass-ink)]" />
      {t.saved}
    </span>
  );
}
