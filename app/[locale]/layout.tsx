import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { Inter } from "next/font/google";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { routing } from "@/i18n/routing";
import { directionForLocale } from "@/i18n/config";
import { brand } from "@/brand.config";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { Toaster } from "@/components/ui/sonner";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "@/app/globals.css";

// Vercel Speed Insights (real-user Core Web Vitals; ADOPT Wave A3). Mounted only
// when the app is actually running on Vercel (`process.env.VERCEL` is set on
// Vercel builds/runtime, unset locally and on non-Vercel hosts like the Docker
// self-host rail). Guarding keeps it inert off-Vercel — no beacon script injected,
// no requests to the `/_vercel/speed-insights` endpoint that only exists there —
// so local dev and self-host builds are byte-for-byte unaffected. Enable data
// collection in the Vercel dashboard → project → Speed Insights.
const onVercel = Boolean(process.env.VERCEL);

type ThemeMode = "light" | "dark" | "system";

// The UI font, self-hosted at build time by next/font (no runtime Google
// request, no layout-shift flash). next/font requires LITERAL option values
// (build-time static analysis), so `variable` must be written out — it MUST
// equal brand.config.ts `font.cssVar` ("--font-sans"), which everything else
// (the AntD fontFamily token, globals.css body) references. A mismatch is
// caught by tests/contracts/design-tokens.test.ts. To swap fonts, change this
// import AND brand.config.ts `font`.
const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// Inline, pre-hydration: for `system` mode the server can't read matchMedia, so
// set the native color-scheme before paint to keep scrollbars/form controls in
// sync and minimize the flash. Explicit light/dark are already handled by the
// cookie-seeded SSR below. Self-contained string — no React context.
//
// SECURITY (must stay constant): this is injected verbatim via
// dangerouslySetInnerHTML into an inline <script>, and the CSP allows
// 'unsafe-inline' for script (AntD SSR + Next bootstrap). It MUST remain a
// static, build-time literal — never interpolate a request value, cookie,
// locale, or any user/runtime input into this string, or it becomes a stored-
// XSS sink that the CSP cannot catch. Read input inside the IIFE at runtime
// (as the cookie read below does), never by string-building the script.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var m = (document.cookie.match(/(?:^|; )theme-mode=([^;]+)/) || [])[1] || "system";
    var dark = m === "dark" || (m === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (e) {}
})();
`;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const messages = (await import(`@/messages/${locale}.json`)).default;
  const direction = directionForLocale(locale);

  // Per-request nonce from middleware (recipe shared-security/3): the inline theme
  // script and AntD's StyleProvider carry it so the CSP can drop 'unsafe-inline'
  // from script-src. Empty string on paths rendered outside middleware.
  const nonce = (await headers()).get("x-nonce") ?? "";

  const cookieStore = await cookies();
  const savedMode = cookieStore.get("theme-mode")?.value;
  const initialMode: ThemeMode =
    savedMode === "light" || savedMode === "dark" || savedMode === "system"
      ? savedMode
      : "system";
  // The server can resolve explicit modes; `system` defers to the client effect.
  const initialIsDark = initialMode === "dark";

  return (
    // suppressHydrationWarning: the THEME_INIT_SCRIPT below sets data-theme +
    // color-scheme on <html> BEFORE hydration (to avoid a theme flash), so the
    // server markup intentionally differs from the post-script DOM. This is the
    // idiomatic React escape hatch for pre-hydration theme scripts; it scopes
    // the suppression to <html>'s own attributes only.
    <html
      lang={locale}
      dir={direction}
      className={sans.variable}
      // brand.config.ts → CSS custom properties. The Tailwind @theme block in
      // app/tokens.css consumes these (ADR-029 C1), so the white-label config
      // stays the single source of brand color + font-fallback values.
      style={
        {
          "--brand-primary": brand.colors.primary,
          "--brand-accent": brand.colors.accent,
          "--font-sans-fallback": brand.font.fallback,
        } as React.CSSProperties
      }
      suppressHydrationWarning
    >
      <head>
        {/* The inline theme script carries the per-request nonce (CSP script-src). */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* AntD's SSR <style> tags fall under style-src 'unsafe-inline' (kept for
              AntD 6 emotion inline-style attributes), so the stock registry is fine —
              only SCRIPT needs the nonce, handled on the inline script above and by
              Next's automatic nonce propagation (CSP set on the request in middleware). */}
          <AntdRegistry>
            <ThemeProvider
              direction={direction}
              initialMode={initialMode}
              initialIsDark={initialIsDark}
            >
              {/* QueryProvider sits inside ThemeProvider; its error-toast bridge
                  fires sonner toasts (useNotify → sonner, ADR-029 C3.5). ADR-021. */}
              <QueryProvider>{children}</QueryProvider>
              {/* sonner toast host — inside ThemeProvider so it reads useTheme()
                  for the light/dark toast theme (replaces AntD App.message). */}
              <Toaster />
            </ThemeProvider>
          </AntdRegistry>
        </NextIntlClientProvider>
        {/* Inert unless running on Vercel — see onVercel above. */}
        {onVercel ? <SpeedInsights /> : null}
      </body>
    </html>
  );
}
