/**
 * Categorical palette for charts (components/shared/Chart). Recharts has no
 * theme awareness, so the series colors live HERE — the one design-token home
 * for chart hex — not hardcoded in the chart component (which the
 * `no-raw-hex-color` ESLint rule forbids). This file is the sanctioned home the
 * rule EXEMPTS: it inherits the token-source role the deleted
 * `components/layout/antd-theme.ts` held (ADR-029, Workstream C4). Harmonized
 * with the indigo brand accent; rebrand by editing the array below.
 *
 * Dark-mode chart theming (rendering these as CSS-var `fill`s that swap per
 * mode) is deferred to workstream D — recharts renders `fill` as a static SVG
 * attribute, so a `var()` would need a runtime read.
 */
export const chartPalette = [
  "#4f46e5", // indigo (primary)
  "#16a34a", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#0ea5e9", // sky
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
];
