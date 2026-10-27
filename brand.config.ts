// brand.config.ts — the white-label contract (Rihal Design System, ADR-029).
//
// Brand: Rihal HR platform look v0.2, deep teal #0f766e (ONE accent, solid — no gradient on product surfaces),
// Geist / Geist Mono, neutral surfaces, dark via the [data-theme="dark"] swap.
// To rebrand a fork, edit ONLY the values below.
//
// ONE place a fork (or a per-client build) sets its visual identity: app name,
// brand colors, corner radius, density, and the UI font. Everything downstream
// derives from here:
//   - app/tokens.css (@theme)           → Tailwind color utilities (bg-primary/text-accent)
//   - app/[locale]/layout.tsx           → emits --brand-* CSS vars on <html>, loads the font (next/font) + <html dir>
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
// NOTE: this file is exempt from the no-raw-hex-color ESLint rule — it is a token
// SOURCE, the one legitimate home for brand hex. Don't scatter hex elsewhere;
// pull from the semantic token utilities (bg-primary, text-accent…) instead.

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
    /** Brand USED AS TEXT (links, active nav/sort, brand icons). Split per theme
     *  for WCAG AA: raw royal is only ~3.9:1 on white and ~3:1 on the dark shell.
     *  layout.tsx binds `light` to --brand-primary-emphasis (→ --primary-emphasis);
     *  globals.css overrides --primary-emphasis to `dark` under [data-theme="dark"]. */
    primaryEmphasis: { light: string; dark: string };
  };
  /** Base corner radius (px). Kept in lockstep with --radius-base in tokens.css. */
  radius: number;
  /** `comfortable` = default sizing; `compact` for data-dense tools. */
  density: BrandDensity;
  font: {
    /** CSS variable next/font binds in layout.tsx and the token chains first.
     *  Typed as a CSS custom-property name so next/font accepts it directly. */
    cssVar: `--${string}`;
    /** Human-readable family name (documentation / fallback head). */
    family: string;
    /** System fallback stack appended after the loaded webfont. */
    fallback: string;
    /** Monospace family for IDs, codes, metrics and code (bound to --font-mono). */
    mono: string;
    /** CSS variable next/font binds the mono family to (the `font-mono` utility). */
    monoCssVar: `--${string}`;
  };
  /** <meta name="theme-color"> (browser chrome on mobile). */
  themeColor: string;
}

const appName = process.env.NEXT_PUBLIC_APP_NAME?.trim() || "My App";

export const brand: BrandConfig = {
  appName,
  description:
    "Rihal Group's HR system: people, performance, joiners and leavers, hiring and HR tickets",
  monogram: appName.charAt(0).toUpperCase() || "A",

  colors: {
    // Rihal HR platform look v0.2 (shared by every HR app; HIVE ADR-076): ONE
    // deep-teal accent, solid. Measured in tests/contracts/platform-palette:
    //   #0f766e + white ............ 5.47:1  (button surface)
    //   #0b5d57 on white ........... 7.73:1  (brand as text, light)
    //   #7fddd3 on #0c111d/#121826 . 11.8 / 11.1:1 (brand as text, dark)
    primary: "#0f766e",
    accent: "#0b5d57", // teal-as-text, so text-accent never adds a second brand colour
    // Brand-as-text, per theme, for WCAG AA.
    primaryEmphasis: { light: "#0b5d57", dark: "#7fddd3" },
  },

  // Softer corners read more premium; lockstep with --radius-base in tokens.css
  // (asserted by tests/contracts/design-tokens.test.ts).
  radius: 8,

  // Comfortable by default; flip to "compact" for dense, table-heavy tools.
  density: "comfortable",

  font: {
    // app/[locale]/layout.tsx loads Geist via next/font and binds it to this var.
    // Geist = the engineered product grotesk (Vercel/Linear register).
    cssVar: "--font-sans",
    family: "Geist",
    fallback:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans Arabic", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
    // Geist Mono for IDs, codes, metrics and code (bound to --font-mono in layout).
    mono: "Geist Mono",
    monoCssVar: "--font-mono",
  },

  themeColor: "#0f766e",
};

/** The full CSS `font-family` value: the loaded webfont var, then the fallback. */
export const brandFontFamily = `var(${brand.font.cssVar}), ${brand.font.fallback}`;
