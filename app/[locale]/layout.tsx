import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import localFont from "next/font/local";
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

// The UI font (Geist) + mono (Geist Mono), served from files VENDORED IN THIS REPO
// (`app/fonts/*.woff2`) via next/font/local.
//
// These were `next/font/google` until 2026-08-21. That is self-hosted at RUNTIME —
// the browser never talks to Google — but it fetches the font files from
// fonts.googleapis.com at BUILD time, which made the network a build dependency.
// The old comment here said "no runtime Google request" and was silent on that,
// which is why it went unnoticed until a Docker build failed with "There was an
// issue establishing a connection while requesting fonts.googleapis.com". Any
// air-gapped, proxied or offline build hit the same wall; the sandbox just found it
// first. Vendoring removes the dependency instead of accommodating it.
//
// One variable file per family (weight 100..900), which is exactly what the Google
// import requested via `wght@100..900` — same bytes the browser used to download,
// now same-origin. Files come from the official `geist` npm package (v1.7.2,
// vercel/geist-font, SIL OFL 1.1); the package itself is NOT a dependency, since
// two static assets do not need one.
//
// The rule and the sweep behind it: docs/decisions/ADR-063.
//
// next/font requires LITERAL option values (build-time static analysis), so
// `variable` must be written out — `sans` MUST equal brand.config.ts `font.cssVar`
// ("--font-sans") and `mono` its `font.monoCssVar` ("--font-mono"), which
// everything downstream (globals.css body, the `font-mono` utility) references.
// A mismatch is caught by tests/contracts/design-tokens.test.ts. To swap fonts,
// replace the files below AND brand.config.ts `font`.
const sans = localFont({
  src: "../fonts/Geist-Variable.woff2",
  weight: "100 900",
  variable: "--font-sans",
  display: "swap",
});
const mono = localFont({
  src: "../fonts/GeistMono-Variable.woff2",
  weight: "100 900",
  variable: "--font-mono",
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
    savedMode === "light" || savedMode === "dark" || savedMode === "system" ? savedMode : "system";
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
      className={`${sans.variable} ${mono.variable}`}
      // brand.config.ts → CSS custom properties. The Tailwind @theme block in
      // app/tokens.css consumes these (ADR-029 C1), so the white-label config
      // stays the single source of brand color + font-fallback values.
      style={
        {
          "--brand-primary": brand.colors.primary,
          "--brand-accent": brand.colors.accent,
          // Brand-as-text (links, active nav, brand icons) for the LIGHT theme —
          // tokens.css binds --primary-emphasis to this; globals.css overrides it
          // for dark. Split from --brand-primary so brand-as-text clears WCAG AA.
          "--brand-primary-emphasis": brand.colors.primaryEmphasis.light,
          "--font-sans-fallback": brand.font.fallback,
        } as React.CSSProperties
      }
      suppressHydrationWarning
    >
      <head>
        {/* The inline theme script carries the per-request nonce (CSP script-src).
            suppressHydrationWarning: React 19 does not echo the `nonce` value into the
            SSR HTML (it applies the CSP nonce but blanks the attribute in the hydration
            snapshot for security), so the server (nonce="") vs client (real nonce) diff
            is expected and harmless. The <html> suppression does not reach this
            two-levels-deep <script>, so scope the escape hatch to the script itself. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* AntdRegistry removed (C3.5): the chrome no longer renders AntD, so
              there are no AntD SSR <style> tags to extract. The CSP style-src
              'unsafe-inline' exception in middleware.ts goes unused until C4
              removes it (do NOT touch middleware here — C4). */}
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
        </NextIntlClientProvider>
        {/* Inert unless running on Vercel — see onVercel above. */}
        {onVercel ? <SpeedInsights /> : null}
      </body>
    </html>
  );
}
