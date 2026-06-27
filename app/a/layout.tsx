import { headers } from "next/headers";
import { Inter, Sora, IBM_Plex_Sans_Arabic } from "next/font/google";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import "@/app/globals.css";

// The candidate runner (UI-SPEC C.1–C.5) is DELIBERATELY outside the [locale]
// segment and NOT next-intl routed — it owns its EN/AR + RTL in-page (switchable
// mid-assessment, C.5). So it ships its own <html>/<body>, mirroring the locale
// layout's next/font setup, but WITHOUT NextIntlClientProvider. Initial markup is
// lang="en" dir="ltr"; the client Runner adjusts <html lang|dir> on locale change.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap" });
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});

export default async function CandidateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Per-request nonce from middleware so the next-themes inline script satisfies
  // the nonce-based script-src CSP (same as the locale layout).
  const nonce = (await headers()).get("x-nonce") ?? "";

  return (
    // suppressHydrationWarning: next-themes sets data-theme on <html> pre-hydration.
    <html
      lang="en"
      dir="ltr"
      className={`${inter.variable} ${sora.variable} ${plexArabic.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider nonce={nonce}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
