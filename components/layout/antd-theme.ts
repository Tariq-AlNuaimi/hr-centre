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
