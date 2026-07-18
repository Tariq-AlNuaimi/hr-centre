import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brand } from "../../brand.config";
import { chartPalette } from "../../components/shared/chart-palette";

// Design-system DRIFT gate (fix-list P0.1 / P1.4 / P1.5). Runs in the warm
// `/ship` "contract tests" phase — no browser, no DB. It locks the invariant
// behind the whole design-system program: anything a human could type twice is
// a drift risk, so every displayed/derived value has exactly ONE source and this
// test fails the moment a second copy appears. The interaction / axe / visual
// side lives in the browser tier (tests/uat/design-system.uat.ts).

const root = join(import.meta.dirname, "..", "..");
const tokensCss = readFileSync(join(root, "app", "tokens.css"), "utf8");
const globalsCss = readFileSync(join(root, "app", "globals.css"), "utf8");

// --- P1.4: the font family name lives ONLY in brand.config.ts ---------------
// The token layer references the CSS var, never the family string, so an
// Inter→Geist swap can't leave a stale name behind (the bug this program found).
for (const [name, css] of [
  ["tokens.css", tokensCss],
  ["globals.css", globalsCss],
] as const) {
  test(`${name} never hardcodes a font-family name (single source: brand.config.ts)`, () => {
    for (const family of [brand.font.family, brand.font.mono, "Inter"]) {
      assert.ok(
        !css.includes(family),
        `${name} must not name the font family "${family}" — reference the token/brand.config instead`,
      );
    }
  });
}

// --- P0.1: the sans fallback is a real, non-empty stack ----------------------
// layout.tsx emits --font-sans-fallback from this; if it were ever empty the
// generated `--font-sans: var(--font-sans), <fallback>` would serialize a bad
// value. Guarding the source guarantees no `undefined`/empty ever ships.
test("brand.font.fallback is a non-empty font stack", () => {
  assert.equal(typeof brand.font.fallback, "string");
  assert.ok(brand.font.fallback.trim().length > 0, "brand.font.fallback must be non-empty");
});

// --- P1.5: displayed values are computed from one source, never re-typed -----
test("chart series 1 IS the brand primary (one source, no second copy)", () => {
  assert.equal(chartPalette[0], brand.colors.primary);
});

test("brand-as-text emphasis is a distinct AA-safe value, not raw brand", () => {
  // Raw royal fails WCAG AA as body text (~3.9:1 on white, ~3:1 on the dark
  // shell); the emphasis split MUST differ from the raw brand in both themes.
  assert.notEqual(brand.colors.primaryEmphasis.light, brand.colors.primary);
  assert.notEqual(brand.colors.primaryEmphasis.dark, brand.colors.primary);
});

// --- P0.1 (belt-and-braces): no `undefined`/`null`/`NaN` leaked into the
// committed token CSS as a value ------------------------------------------
for (const [name, css] of [
  ["tokens.css", tokensCss],
  ["globals.css", globalsCss],
] as const) {
  test(`${name} contains no undefined/null/NaN CSS values`, () => {
    const m = css.match(/:\s*(undefined|null|NaN)\b/);
    assert.equal(m, null, `${name} has a bad value: ${m?.[0]}`);
  });
}
