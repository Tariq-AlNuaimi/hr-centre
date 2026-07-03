"use client";

import { createContext, useContext, useEffect, useState } from "react";

type ThemeMode = "light" | "dark" | "system";

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "system",
  setMode: () => {},
  isDark: false,
});

export function useTheme() {
  return useContext(ThemeContext);
}

function getSystemDark() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({
  children,
  initialMode = "system",
  initialIsDark = false,
}: {
  children: React.ReactNode;
  /** Kept for call-compatibility with app/[locale]/layout.tsx, which passes the
   * resolved <html dir>. AntD's ConfigProvider consumed it; the shadcn/Radix
   * layer reads direction straight from the document, so it's accepted but
   * unused here. */
  direction?: "ltr" | "rtl";
  /** Seeded from the `theme-mode` cookie on the server so SSR and the first
   * client paint agree — avoids the light→saved-theme flash (FOUC). */
  initialMode?: ThemeMode;
  /** Server's best guess at dark, so the first paint matches the cookie. For
   * `system` mode the server can't read matchMedia; the effect corrects it. */
  initialIsDark?: boolean;
}) {
  const [mode, setMode] = useState<ThemeMode>(initialMode);
  const [isDark, setIsDark] = useState(initialIsDark);

  useEffect(() => {
    localStorage.setItem("theme-mode", mode);
    // Persist to a cookie too so the server can render the right theme on the
    // next request and skip the flash. 1-year, lax, path=/.
    document.cookie = `theme-mode=${mode}; path=/; max-age=31536000; samesite=lax`;
    if (mode === "system") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsDark(getSystemDark());
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    } else {
      setIsDark(mode === "dark");
    }
  }, [mode]);

  // Mirror the resolved theme onto <html> so plain CSS (e.g. scrollbar styling
  // in globals.css) can follow the in-app toggle, not just the OS preference.
  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  }, [isDark]);

  return (
    <ThemeContext.Provider value={{ mode, setMode, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}
