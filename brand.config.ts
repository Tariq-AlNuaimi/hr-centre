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

const appName =
  process.env.NEXT_PUBLIC_APP_NAME?.trim() || "Rihal Aptitude";

export const brand: BrandConfig = {
  appName,
  description:
    "Rihal Aptitude — a standards-anchored, evidence-traceable assessment of behavioral fit for a role family.",
  monogram: "R",

  colors: {
    // UI-SPEC A.2 — brand deep blue + the azure "journey" accent. The full token
    // set lives in app/globals.css (@theme); these feed brand metadata only.
    primary: "#123047",
    accent: "#2e7da6",
  },

  // 10px cards (UI-SPEC A.4); the radius scale derives from --radius in globals.
  radius: 10,

  // Data-instrument density.
  density: "compact",

  font: {
    // Body/UI face. The display face (Sora) + Arabic face (IBM Plex Sans Arabic)
    // are loaded alongside in app/[locale]/layout.tsx (next/font).
    cssVar: "--font-inter",
    family: "Inter",
    fallback:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },

  themeColor: "#123047",
};

/** The full CSS `font-family` value: the loaded webfont var, then the fallback. */
export const brandFontFamily = `var(${brand.font.cssVar}), ${brand.font.fallback}`;
