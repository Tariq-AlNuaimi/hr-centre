"use client";

import { Toaster as SonnerToaster } from "sonner";
import { useTheme } from "@/components/layout/ThemeProvider";

/**
 * Toaster — sonner toast host (ADR-029, Workstream C3.5). Replaces AntD's
 * `App.message` API (see hooks/use-notify.ts). Theme-aware via the app's own
 * `useTheme().isDark` (NOT sonner's own system detection) so toasts follow the
 * in-app light/dark toggle + cookie, exactly like the rest of the chrome.
 * `richColors` gives semantic success/error/info/warning coloring; positioned
 * top-end and RTL-safe (sonner reads the document `dir`). Mounted once inside
 * ThemeProvider in app/[locale]/layout.tsx.
 */
export function Toaster() {
  const { isDark } = useTheme();
  return (
    <SonnerToaster
      theme={isDark ? "dark" : "light"}
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        className: "font-sans",
      }}
    />
  );
}
