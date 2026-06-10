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
 */
export const brandTokens: NonNullable<ThemeConfig["token"]> = {
  colorPrimary: "#1677ff",
  borderRadius: 6,
  fontSize: 14,
};

/**
 * The full AntD theme for a given mode. Neutral / background tokens MUST be set
 * per-mode: hardcoding a light neutral onto brandTokens would bleed into dark
 * mode (the classic AntD trap), so they live here where `isDark` is known.
 * ThemeProvider applies the light/dark algorithm on top of this.
 *
 * Goal is a *considered enterprise* look, not a distinctive one — tuned
 * neutrals, calmer table chrome, single-elevation surfaces — all inside AntD's
 * standard idiom so the tool stays familiar and hands off clean to IT. Density
 * stays at AntD's comfortable default; switch to the compact algorithm in
 * ThemeProvider when a fork's screens are genuinely data-dense.
 */
export function buildTheme(isDark: boolean): ThemeConfig {
  // Mode-keyed neutrals. Dark values align with the scrollbar colors already in
  // app/globals.css so chrome and scrollbars share one palette.
  const n = isDark
    ? { layout: "#141414", surface: "#1f1f1f", tableHeader: "#1f1f1f", rowHover: "#262626", border: "#303030" }
    : { layout: "#f4f5f7", surface: "#ffffff", tableHeader: "#fafbfc", rowHover: "#f5f7fa", border: "#eef0f2" };

  return {
    token: {
      ...brandTokens,
      colorBgLayout: n.layout,
    },
    components: {
      Layout: {
        headerBg: n.surface,
        siderBg: n.surface,
        bodyBg: n.layout,
        headerPadding: "0 24px",
      },
      Table: {
        headerBg: n.tableHeader,
        rowHoverBg: n.rowHover,
        borderColor: n.border,
        cellPaddingBlock: 12,
        headerSplitColor: "transparent",
      },
      Menu: {
        itemBorderRadius: 6,
        itemMarginInline: 8,
      },
    },
  };
}
