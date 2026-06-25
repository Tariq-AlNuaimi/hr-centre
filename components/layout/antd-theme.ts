import type { ThemeConfig } from "antd";

/**
 * The fork's visual identity, in AntD-token form — the single place to retune
 * brand color, radius, and type for the whole app (ThemeProvider feeds it to
 * ConfigProvider; the dark/light algorithm is chosen there at runtime).
 *
 * app/tokens.css is the same ruler for plain-CSS land; the overlapping values
 * (borderRadius = --radius-base, fontSize = --font-size-base) are asserted in
 * lockstep by tests/contracts/design-tokens.test.ts — change one, change both.
 *
 * Rebranding a fork: change colorPrimary (and radius if the brand calls for
 * it) HERE, not per-component. One accent per app — per-screen accent colors
 * are a design-QA finding (docs/uat-rubric.md).
 *
 * Premium font note: the stack leads with "Inter" but does NOT load it, so it
 * falls back to the (excellent) system UI font everywhere. To actually ship
 * Inter, wire `next/font/google` in app/[locale]/layout.tsx and expose its CSS
 * variable here — purely additive, no token churn.
 */
export const brandTokens: NonNullable<ThemeConfig["token"]> = {
  // Refined indigo accent — a modern, premium-feeling default that still reads
  // as "enterprise blue". Forks rebrand this one value.
  colorPrimary: "#4f46e5",
  colorInfo: "#4f46e5",
  // Cohesive, slightly desaturated semantic set (modern over stock AntD).
  colorSuccess: "#16a34a",
  colorWarning: "#f59e0b",
  colorError: "#ef4444",
  // Softer corners read more premium; lockstep with --radius-base in tokens.css.
  borderRadius: 8,
  fontSize: 14,
  fontFamily:
    '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
  fontWeightStrong: 600,
  // Generous control sizing — the spacious, deliberate feel of Linear/Stripe.
  controlHeight: 36,
  controlHeightLG: 44,
  controlHeightSM: 28,
  // Slightly tighter line height for crisper type blocks.
  lineHeight: 1.5715,
};

/**
 * Categorical palette for charts (components/shared/Chart). Recharts has no
 * theme awareness, so the series colors live HERE — the one design-token home —
 * not hardcoded in the chart component (which the no-raw-hex-color ESLint rule
 * forbids). Harmonized with the indigo accent above; rebrand by editing it.
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

/**
 * The full AntD theme for a given mode. Neutral / background / elevation tokens
 * MUST be set per-mode: hardcoding a light neutral onto brandTokens would bleed
 * into dark mode (the classic AntD trap), so they live here where `isDark` is
 * known. ThemeProvider applies the light/dark algorithm on top of this.
 *
 * Goal is a *considered, premium* enterprise look — refined neutral grays,
 * soft layered elevation, a calm tinted menu-selection, and roomy controls —
 * all inside AntD's standard idiom so the tool stays familiar and hands off
 * clean to IT. Density stays at AntD's comfortable default; switch to the
 * compact algorithm in ThemeProvider when a fork's screens are data-dense.
 */
export function buildTheme(isDark: boolean): ThemeConfig {
  // Mode-keyed neutrals + elevation. Dark values align with the scrollbar
  // colors in app/globals.css so chrome and scrollbars share one palette.
  const n = isDark
    ? {
        layout: "#0f1115",
        surface: "#171a21",
        elevated: "#1d2129",
        tableHeader: "#1a1e25",
        rowHover: "#1f242c",
        border: "#272c35",
        borderSecondary: "#20242c",
        // Calm indigo wash for the selected nav item (no harsh fill).
        menuSelectedBg: "rgba(99, 102, 241, 0.18)",
        menuSelectedColor: "#a5b4fc",
        shadow:
          "0 1px 2px rgba(0, 0, 0, 0.32), 0 1px 3px rgba(0, 0, 0, 0.44)",
        shadowSecondary:
          "0 6px 16px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.36)",
        shadowTertiary: "0 1px 2px rgba(0, 0, 0, 0.32)",
      }
    : {
        layout: "#f7f8fa",
        surface: "#ffffff",
        elevated: "#ffffff",
        tableHeader: "#fafafb",
        rowHover: "#f6f7f9",
        border: "#e8eaed",
        borderSecondary: "#eef0f3",
        menuSelectedBg: "#eef2ff",
        menuSelectedColor: "#4f46e5",
        shadow:
          "0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.07)",
        shadowSecondary:
          "0 8px 24px rgba(16, 24, 40, 0.08), 0 2px 6px rgba(16, 24, 40, 0.05)",
        shadowTertiary: "0 1px 2px rgba(16, 24, 40, 0.05)",
      };

  return {
    token: {
      ...brandTokens,
      colorBgLayout: n.layout,
      colorBgContainer: n.surface,
      colorBgElevated: n.elevated,
      colorBorder: n.border,
      colorBorderSecondary: n.borderSecondary,
      boxShadow: n.shadow,
      boxShadowSecondary: n.shadowSecondary,
      boxShadowTertiary: n.shadowTertiary,
    },
    components: {
      Layout: {
        headerBg: n.surface,
        siderBg: n.surface,
        bodyBg: n.layout,
        headerPadding: "0 24px",
        headerHeight: 60,
      },
      Table: {
        headerBg: n.tableHeader,
        rowHoverBg: n.rowHover,
        borderColor: n.border,
        headerColor: isDark ? "#9aa3b2" : "#5b6472",
        cellPaddingBlock: 14,
        headerSplitColor: "transparent",
        headerBorderRadius: 8,
      },
      Menu: {
        itemBorderRadius: 8,
        itemMarginInline: 8,
        itemHeight: 42,
        itemSelectedBg: n.menuSelectedBg,
        itemSelectedColor: n.menuSelectedColor,
        itemColor: isDark ? "#c5ccd6" : "#4b5563",
        iconMarginInlineEnd: 12,
      },
      Button: {
        fontWeight: 500,
        // Flatter primaries read more modern than AntD's default drop shadow.
        primaryShadow: "none",
        defaultShadow: "none",
        paddingInline: 16,
      },
      Card: {
        paddingLG: 24,
      },
      Segmented: { borderRadius: 8 },
      Modal: { borderRadiusLG: 12 },
      Notification: { borderRadiusLG: 12 },
      Message: { borderRadiusLG: 10 },
    },
  };
}
