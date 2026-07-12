import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { RootProvider } from "fumadocs-ui/provider/next";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { auth } from "@/lib/auth";
import { source } from "@/lib/docs/source";
import { brand } from "@/brand.config";

// /{locale}/docs — internal-only docs site (ADR-053, blueprint AC-3.1).
//
// Auth: middleware is the primary gate (`/docs` is not in `publicPaths`); this
// server-side session check is defense in depth, mirroring the authed pages.
// Public-docs forks remove this check AND add `/docs` to middleware
// `publicPaths` (AC-3.2 — only non-Restricted content belongs in a public tree).
//
// Theme: the app's ThemeProvider owns light/dark (data-theme on <html>), so
// Fumadocs' own next-themes provider and theme switch are DISABLED; its
// `--color-fd-*` tokens are mapped onto the app tokens in fumadocs-tokens.css,
// which already flip with the app's data-theme. RTL follows <html dir> set by
// the locale layout (AC-1.3).
export default async function DocsSiteLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (!session) redirect(`/${locale}/login`);

  return (
    <RootProvider theme={{ enabled: false }} search={{ options: { api: "/api/docs-search" } }}>
      <DocsLayout
        tree={source.getPageTree()}
        nav={{ title: `${brand.appName} Docs` }}
        themeSwitch={{ enabled: false }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
