"use client";

import * as React from "react";

// Autosave plumbing for the runner (UI-SPEC C.2/C.3). Each answer is POSTed
// optimistically; a failure NEVER loses the answer — it surfaces an inline
// "Couldn't save — Retry" the caller renders, and the value stays in React state.

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type ResponseBody =
  | { kind: "item"; itemNumber: number; value: number }
  | { kind: "sjt"; sjtItemId: string; chosenOptionId: string };

async function postResponse(token: string, body: ResponseBody): Promise<void> {
  const res = await fetch(`/api/run/${encodeURIComponent(token)}/response`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `Save failed (${res.status})`);
  }
}

// A keyed autosave: tracks per-key status and a retry of the last payload for
// that key. The key is the item number (items) or the sjt item id (sjt).
export function useAutosave(token: string) {
  const [statuses, setStatuses] = React.useState<Map<string, SaveStatus>>(
    () => new Map()
  );
  // Latest payload per key, so Retry resends what the candidate last chose.
  const pending = React.useRef<Map<string, ResponseBody>>(new Map());

  const setStatus = React.useCallback((key: string, s: SaveStatus) => {
    setStatuses((m) => new Map(m).set(key, s));
  }, []);

  const run = React.useCallback(
    async (key: string, body: ResponseBody) => {
      pending.current.set(key, body);
      setStatus(key, "saving");
      try {
        await postResponse(token, body);
        // Only clear to "saved" if this is still the latest payload for the key.
        if (pending.current.get(key) === body) setStatus(key, "saved");
      } catch {
        setStatus(key, "error");
      }
    },
    [token, setStatus]
  );

  const save = React.useCallback(
    (key: string, body: ResponseBody) => {
      void run(key, body);
    },
    [run]
  );

  const retry = React.useCallback(
    (key: string) => {
      const body = pending.current.get(key);
      if (body) void run(key, body);
    },
    [run]
  );

  const statusOf = React.useCallback(
    (key: string): SaveStatus => statuses.get(key) ?? "idle",
    [statuses]
  );

  return { save, retry, statusOf };
}

// Consent POST (UI-SPEC C.1). Must succeed before any answer is saved.
export async function postConsent(
  token: string,
  locale: "en" | "ar"
): Promise<{ assessmentId: string; locale: string }> {
  const res = await fetch(`/api/run/${encodeURIComponent(token)}/consent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consent: true, locale }),
  });
  const data = (await res.json().catch(() => null)) as {
    data?: { assessmentId: string; locale: string };
    error?: string;
  } | null;
  if (!res.ok || !data?.data) {
    throw new Error(data?.error ?? `Consent failed (${res.status})`);
  }
  return data.data;
}

// Submit POST (UI-SPEC C.4). A 409 (already submitted) is treated as success —
// the sitting is done either way.
export async function postSubmit(token: string): Promise<void> {
  const res = await fetch(`/api/run/${encodeURIComponent(token)}/submit`, {
    method: "POST",
  });
  if (res.ok) return;
  if (res.status === 409) return; // already submitted — completion is correct
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(data?.error ?? `Submit failed (${res.status})`);
}
