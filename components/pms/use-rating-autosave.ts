"use client";

import { useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * P2-3 — autosave for a rating draft. When a draft is complete enough to save
 * (`ready`) and differs from what is stored, it is saved after a short pause in
 * typing; the status is reported per KPI so the screen can say "Saved" or
 * "Not saved" next to the field instead of a toast per keystroke.
 *
 * Saving here is the same POST the Save button makes, so every server rule
 * (stage lock, divergence reason, sign-off) applies unchanged.
 */
export function useRatingAutosave(params: {
  drafts: Record<string, { level: number; comment: string }>;
  stored: (kpiId: string) => { level: number; comment: string };
  ready: (kpiId: string) => boolean;
  save: (kpiId: string) => Promise<void>;
  enabled: boolean;
  delayMs?: number;
}): Record<string, AutosaveStatus> {
  const { drafts, stored, ready, save, enabled, delayMs = 1500 } = params;
  const [status, setStatus] = useState<Record<string, AutosaveStatus>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    if (!enabled) return;
    const pending = timers.current;
    for (const [kpiId, draft] of Object.entries(drafts)) {
      const current = stored(kpiId);
      const changed = draft.level !== current.level || draft.comment.trim() !== current.comment;
      const existing = pending.get(kpiId);
      if (existing) clearTimeout(existing);
      if (!changed || !ready(kpiId)) continue;
      pending.set(
        kpiId,
        setTimeout(() => {
          setStatus((s) => ({ ...s, [kpiId]: "saving" }));
          save(kpiId).then(
            () => setStatus((s) => ({ ...s, [kpiId]: "saved" })),
            () => setStatus((s) => ({ ...s, [kpiId]: "error" })),
          );
        }, delayMs),
      );
    }
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
    // `stored`/`ready`/`save` are recreated per render; the drafts are the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, enabled, delayMs]);

  return status;
}
