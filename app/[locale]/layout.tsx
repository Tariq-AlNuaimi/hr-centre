import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { Inter, Sora, IBM_Plex_Sans_Arabic } from "next/font/google";
import { routing } from "@/i18n/routing";
import { directionForLocale } from "@/i18n/config";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import "@/app/globals.css";

// A.3 Typography — self-hosted at build time by next/font (no runtime Google
// request, no layout-shift flash). next/font requires LITERAL option values, so
// each variable is written out; the names match the --font-* vars globals.css
// @theme reads (--font-inter / --font-sora / --font-plex-arabic).
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
});
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});

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

  // Per-request nonce from middleware so the next-themes inline script satisfies
  // the nonce-based script-src CSP. Empty string outside middleware.
  const nonce = (await headers()).get("x-nonce") ?? "";

  return (
    // suppressHydrationWarning: next-themes sets data-theme/style on <html>
    // before hydration to avoid a theme flash, so server markup intentionally
    // differs from the post-script DOM.
    <html
      lang={locale}
      dir={direction}
      className={`${inter.variable} ${sora.variable} ${plexArabic.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider nonce={nonce}>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
