import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { routing } from "@/i18n/routing";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import "@/app/globals.css";

type ThemeMode = "light" | "dark" | "system";

// Inline, pre-hydration: for `system` mode the server can't read matchMedia, so
// set the native color-scheme before paint to keep scrollbars/form controls in
// sync and minimize the flash. Explicit light/dark are already handled by the
// cookie-seeded SSR below. Self-contained string — no React context.
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
  const direction = locale === "ar" ? "rtl" : "ltr";

  const cookieStore = await cookies();
  const savedMode = cookieStore.get("theme-mode")?.value;
  const initialMode: ThemeMode =
    savedMode === "light" || savedMode === "dark" || savedMode === "system"
      ? savedMode
      : "system";
  // The server can resolve explicit modes; `system` defers to the client effect.
  const initialIsDark = initialMode === "dark";

  return (
    <html lang={locale} dir={direction}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AntdRegistry>
            <ThemeProvider
              direction={direction}
              initialMode={initialMode}
              initialIsDark={initialIsDark}
            >
              {children}
            </ThemeProvider>
          </AntdRegistry>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
