/**
 * Categorical palette for charts (components/shared/Chart). Recharts has no
 * theme awareness, so the series colors live HERE — the one design-token home
 * for chart hex — not hardcoded in the chart component (which the
 * `no-raw-hex-color` ESLint rule forbids). This file is the sanctioned home the
 * rule EXEMPTS: it inherits the token-source role the deleted
 * `components/layout/antd-theme.ts` held (ADR-029, Workstream C4). Series 1 is
 * the royal brand; the rest are distinct but muted so charts read operational,
 * not festive. Single-series charts use series 1 (royal) alone. Rebrand by
 * editing the array below.
 *
 * Dark-mode chart theming (rendering these as CSS-var `fill`s that swap per
 * mode) is deferred to workstream D — recharts renders `fill` as a static SVG
 * attribute, so a `var()` would need a runtime read.
 */
export const chartPalette = [
  "#0165ff", // royal — series 1 / brand
  "#0bb39a", // teal
  "#7a4dff", // violet
  "#f59e0b", // amber
  "#e05252", // rose
  "#0894ee", // sky
];
