/**
 * Categorical palette for charts (components/shared/Chart). Recharts has no
 * theme awareness, so the series colors live HERE — the one design-token home
 * for chart hex — not hardcoded in the chart component (which the
 * `no-raw-hex-color` ESLint rule forbids). This file is the sanctioned home the
 * rule EXEMPTS: it inherits the token-source role the deleted
 * `components/layout/antd-theme.ts` held (ADR-029, Workstream C4). Rihal HR
 * platform look v0.2: series 1 is a lifted platform teal (#0f766e itself is
 * only 3.24:1 on the dark card); the rest are distinct hues that each clear 3:1
 * on BOTH the light page and the dark card, because recharts bakes a static
 * fill (measured in tests/contracts/platform-palette.test.ts).
 *
 * Dark-mode chart theming (rendering these as CSS-var `fill`s that swap per
 * mode) is deferred to workstream D — recharts renders `fill` as a static SVG
 * attribute, so a `var()` would need a runtime read.
 */
export const chartPalette = [
  "#12877d", // teal — series 1 / brand
  "#3f7fd0", // blue
  "#c2671c", // orange
  "#7a5af8", // violet
  "#cf5f7a", // rose
  "#6b7a90", // slate
];
