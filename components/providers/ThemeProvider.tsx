"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

// Dark/light is driven by data-theme on <html> (globals.css wires the `dark`
// variant to it). next-themes injects a pre-hydration script (no flash) and
// accepts the per-request CSP nonce.
export function ThemeProvider({
  children,
  nonce,
}: {
  children: React.ReactNode;
  nonce?: string;
}) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      nonce={nonce}
    >
      {children}
    </NextThemesProvider>
  );
}
