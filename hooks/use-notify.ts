"use client";

import { useMemo } from "react";
import { toast } from "sonner";

/**
 * useNotify — the app's toast seam (ADR-029, Workstream C3.5). Rewritten over
 * sonner's context-free `toast.*` (was AntD `App.useApp().message`). The return
 * shape is UNCHANGED — `{ success, error, info, warning, notify }` — so every
 * call site (and QueryProvider's error bridge) keeps working without edits.
 * sonner's `toast()` needs no React context (just the one `<Toaster/>` mounted
 * in the provider chain), so this hook no longer depends on a provider being
 * above it; the memoized object keeps the callbacks referentially stable for the
 * bridge's effect deps.
 */

interface NotifyOptions {
  /** The toast heading. */
  message: string;
  /** Secondary line under the heading. */
  description?: string;
  /** Semantic variant; defaults to a neutral toast. */
  type?: "success" | "error" | "info" | "warning";
}

export function useNotify() {
  return useMemo(() => {
    const success = (content: string) => toast.success(content);
    const error = (content: string) => toast.error(content);
    const info = (content: string) => toast.info(content);
    const warning = (content: string) => toast.warning(content);

    // Rich variant (was AntD `notification`): a heading + description. Routes to
    // the matching semantic toast so the four string helpers stay the common path.
    const notify = ({ message, description, type }: NotifyOptions) => {
      const fn =
        type === "success"
          ? toast.success
          : type === "error"
            ? toast.error
            : type === "info"
              ? toast.info
              : type === "warning"
                ? toast.warning
                : toast;
      return fn(message, description ? { description } : undefined);
    };

    return { success, error, info, warning, notify };
  }, []);
}
