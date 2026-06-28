// brand.config.ts — the white-label contract.
//
// ONE place a fork (or a per-client build) sets its visual identity: app name,
// brand colors, corner radius, density, and the UI font. Everything downstream
// derives from here:
//   - components/layout/antd-theme.ts  → AntD ConfigProvider tokens
//   - components/layout/ThemeProvider   → density algorithm
//   - app/[locale]/layout.tsx           → loads the font (next/font) + <html dir>
//   - app/layout.tsx                    → <title>, theme-color, icons
//   - components/layout/AppHeader.tsx   → logo monogram + wordmark
//
// To rebrand: edit the values below (and replace app/favicon.ico). To swap the
// actual webfont you must ALSO change the `next/font` import in
// app/[locale]/layout.tsx — next/font resolves fonts at build time by static
// analysis, so the font family can't be chosen from a runtime string here; this
// file owns the family NAME + fallback stack that the token references, layout
// owns the import. Keep the two in sync.
//
// NOTE: this file is exempt from the no-raw-hex-color ESLint rule (like
// antd-theme.ts) — it is a token SOURCE, the one legitimate home for brand hex.
// Don't scatter hex elsewhere; pull from the theme tokens instead.

export type BrandDensity = "comfortable" | "compact";

export interface BrandConfig {
  /** Product name — drives <title>, the header wordmark, and metadata. */
  appName: string;
  /** Short tagline used in the document description / metadata. */
  description: string;
  /** 1–2 char logo monogram; defaults to the app name's initial. */
  monogram: string;
  colors: {
    /** Primary brand color (buttons, links, active states, focus rings). */
    primary: string;
    /** Accent for highlights/visualizations; defaults to primary if unsure. */
    accent: string;
  };
  /** Base corner radius (px). Kept in lockstep with --radius-base in tokens.css. */
  radius: number;
  /** `comfortable` = AntD default sizing; `compact` for data-dense tools. */
  density: BrandDensity;
  font: {
    /** CSS variable next/font binds in layout.tsx and the token chains first.
     *  Typed as a CSS custom-property name so next/font accepts it directly. */
    cssVar: `--${string}`;
    /** Human-readable family name (documentation / fallback head). */
    family: string;
    /** System fallback stack appended after the loaded webfont. */
    fallback: string;
  };
  /** <meta name="theme-color"> (browser chrome on mobile). */
  themeColor: string;
}

const appName = process.env.NEXT_PUBLIC_APP_NAME?.trim() || "My App";

export const brand: BrandConfig = {
  appName,
  description: "Fullstack Next.js application",
  monogram: appName.charAt(0).toUpperCase() || "A",

  colors: {
    // Refined indigo — modern, premium, still reads as "enterprise blue".
    primary: "#4f46e5",
    accent: "#4f46e5",
  },

  // Softer corners read more premium; lockstep with --radius-base in tokens.css
  // (asserted by tests/contracts/design-tokens.test.ts).
  radius: 8,

  // Comfortable by default; flip to "compact" for dense, table-heavy tools.
  density: "comfortable",

  font: {
    // app/[locale]/layout.tsx loads Inter via next/font and binds it to this var.
    cssVar: "--font-sans",
    family: "Inter",
    fallback:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
  },

  themeColor: "#4f46e5",
};

/** The full CSS `font-family` value: the loaded webfont var, then the fallback. */
export const brandFontFamily = `var(${brand.font.cssVar}), ${brand.font.fallback}`;
