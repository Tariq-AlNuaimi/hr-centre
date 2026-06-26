import type { Metadata, Viewport } from "next";
import { brand } from "@/brand.config";

// Identity comes from brand.config.ts (white-label single source). The favicon
// is app/favicon.ico (Next file convention) — replace that file to rebrand it.
export const metadata: Metadata = {
  title: brand.appName,
  description: brand.description,
};

// theme-color tints mobile browser chrome to the brand color.
export const viewport: Viewport = {
  themeColor: brand.themeColor,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
