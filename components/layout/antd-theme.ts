import type { ThemeConfig } from "antd";
import { brand, brandFontFamily } from "@/brand.config";

/**
 * The fork's visual identity, in AntD-token form. The white-label values
 * (brand color, radius, font) come from `brand.config.ts` — the single place a
 * fork retunes identity; this file maps them onto AntD tokens and adds the
 * system-level constants (semantic colors, control sizing) that aren't brand.
 * ThemeProvider feeds the result to ConfigProvider; the dark/light algorithm
 * and density are chosen there at runtime.
 *
 * app/tokens.css is the same ruler for plain-CSS land; the overlapping values
 * (borderRadius = --radius-base, fontSize = --font-size-base) are asserted in
 * lockstep by tests/contracts/design-tokens.test.ts — change one, change both.
 *
 * Rebranding a fork: edit `brand.config.ts`, not per-component. One accent per
 * app — per-screen accent colors are a design-QA finding (docs/uat-rubric.md).
 *
 * The font (Inter by default) IS loaded now — app/[locale]/layout.tsx wires it
 * via next/font and binds brand.font.cssVar; `brandFontFamily` chains that var
 * ahead of the system fallback so there's no longer a silent system-font swap.
 */
export const brandTokens: NonNullable<ThemeConfig["token"]> = {
  // Brand color from brand.config.ts (forks rebrand it there, in one place).
  colorPrimary: brand.colors.primary,
  colorInfo: brand.colors.primary,
  // Cohesive, slightly desaturated semantic set (modern over stock AntD).
  colorSuccess: "#16a34a",
  colorWarning: "#f59e0b",
  colorError: "#ef4444",
  // Softer corners read more premium; lockstep with --radius-base in tokens.css.
  borderRadius: brand.radius,
  fontSize: 14,
  fontFamily: brandFontFamily,
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
        // Darker, ready-to-interact border on input hover (one step up).
        controlBorderHover: "#3a414d",
        // Subtle tinted fill for ghost/secondary surfaces (segmented, fills).
        fillSubtle: "rgba(255, 255, 255, 0.04)",
        // Calm indigo wash for the selected nav item (no harsh fill).
        menuSelectedBg: "rgba(99, 102, 241, 0.18)",
        menuSelectedColor: "#a5b4fc",
        // High-contrast tooltip surface (inverts against the dark canvas).
        tooltipBg: "#2a3038",
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
        controlBorderHover: "#c5cad3",
        fillSubtle: "#f4f5f7",
        menuSelectedBg: "#eef2ff",
        menuSelectedColor: "#4f46e5",
        tooltipBg: "#1f2430",
        shadow:
          "0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.07)",
        shadowSecondary:
          "0 8px 24px rgba(16, 24, 40, 0.08), 0 2px 6px rgba(16, 24, 40, 0.05)",
        shadowTertiary: "0 1px 2px rgba(16, 24, 40, 0.05)",
      };

  // On-brand focus ring shared by the input family (mirrors --ring in
  // tokens.css, softened for a premium, non-shouty highlight). Brand-tinted in
  // both modes so focus reads consistently.
  const focusShadow = "0 0 0 3px rgba(79, 70, 229, 0.12)";

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
        // Slightly tighter radius than containers for a crisper control feel.
        borderRadius: 8,
      },
      Card: {
        paddingLG: 24,
        // Cards are the primary surface — give them the large radius + a soft
        // resting elevation so they read as considered panels, not flat boxes.
        borderRadiusLG: 12,
        boxShadowTertiary: n.shadow,
        headerFontSize: 16,
        headerBg: "transparent",
      },
      // --- Input family: consistent height, hover/focus affordance ----------
      Input: {
        paddingBlock: 7,
        paddingInline: 12,
        hoverBorderColor: n.controlBorderHover,
        activeShadow: focusShadow,
        activeBorderColor: brand.colors.primary,
      },
      InputNumber: {
        hoverBorderColor: n.controlBorderHover,
        activeShadow: focusShadow,
        activeBorderColor: brand.colors.primary,
      },
      Select: {
        optionSelectedBg: n.menuSelectedBg,
        optionSelectedColor: n.menuSelectedColor,
        optionSelectedFontWeight: 500,
        controlItemBgHover: n.rowHover,
        borderRadius: 8,
      },
      DatePicker: {
        hoverBorderColor: n.controlBorderHover,
        activeShadow: focusShadow,
        activeBorderColor: brand.colors.primary,
        cellActiveWithRangeBg: n.menuSelectedBg,
      },
      Form: {
        // Calmer, denser label/field rhythm than AntD's roomy default.
        labelColor: isDark ? "#c5ccd6" : "#374151",
        labelFontSize: 14,
        verticalLabelPadding: "0 0 6px",
        itemMarginBottom: 20,
      },
      // --- Navigation & overlays -------------------------------------------
      Tabs: {
        itemColor: isDark ? "#9aa3b2" : "#5b6472",
        itemSelectedColor: brand.colors.primary,
        itemHoverColor: brand.colors.primary,
        inkBarColor: brand.colors.primary,
        titleFontSize: 14,
        horizontalItemPaddingLG: "12px 0",
        horizontalItemGutter: 28,
      },
      Tooltip: {
        borderRadius: 8,
        colorBgSpotlight: n.tooltipBg,
      },
      Dropdown: {
        borderRadiusLG: 12,
        controlItemBgHover: n.rowHover,
        paddingBlock: 6,
      },
      Tag: {
        borderRadiusSM: 6,
      },
      Segmented: { borderRadius: 8, itemSelectedColor: brand.colors.primary },
      Modal: { borderRadiusLG: 12 },
      Drawer: { borderRadiusLG: 12 },
      Popover: { borderRadiusLG: 12 },
      Notification: { borderRadiusLG: 12 },
      Message: { borderRadiusLG: 10 },
    },
  };
}
