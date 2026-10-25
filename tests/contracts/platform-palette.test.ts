import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { brand } from "../../brand.config";
import { chartPalette } from "../../components/shared/chart-palette";

/**
 * The Rihal HR platform look v0.2, measured rather than trusted.
 *
 * v0.2 is the shared look of every Rihal HR app (adopted first by HIVE,
 * ADR-076 there). Every colour pair it puts on screen is re-measured here with
 * the WCAG 2.1 contrast formula, in BOTH themes, at the pairing it is actually
 * used in, reading the stylesheets rather than restating the palette, so a
 * test cannot pass while the CSS says something else.
 */

const TOKENS = readFileSync(
  fileURLToPath(new URL("../../app/tokens.css", import.meta.url)),
  "utf8",
);
const GLOBALS = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);
const DARK_BLOCK = '[data-theme="dark"] {';
const AA_TEXT = 4.5;
const AA_UI = 3;

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const chan = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A custom property's hex, from the light :root (tokens.css) or the dark block (globals.css). */
function cssVar(src: string, name: string, scope?: string): string {
  let body = src;
  if (scope) {
    const at = src.indexOf(scope);
    assert.notEqual(at, -1, `scope ${scope} not found`);
    body = src.slice(src.indexOf("{", at), src.indexOf("\n}", at));
  }
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(body);
  assert.ok(m, `${name} not found${scope ? " in the dark block" : ""} — did a token get renamed?`);
  return m![1].toLowerCase();
}

/** `color-mix(in srgb, a t, b)` for two opaque hex colours. */
function mix(a: string, b: string, t: number): string {
  return (
    "#" +
    [1, 3, 5]
      .map((i) =>
        Math.round(parseInt(a.slice(i, i + 2), 16) * t + parseInt(b.slice(i, i + 2), 16) * (1 - t))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

describe("platform look v0.2 — the accent", () => {
  test("white on the primary surface clears AA (every button)", () => {
    assert.ok(contrast("#ffffff", brand.colors.primary) >= AA_TEXT);
  });

  test("brand-as-text clears AA on white, and on the dark page and card", () => {
    assert.ok(contrast(brand.colors.primaryEmphasis.light, "#ffffff") >= AA_TEXT);
    for (const bg of [
      cssVar(GLOBALS, "--background", DARK_BLOCK),
      cssVar(GLOBALS, "--card", DARK_BLOCK),
    ]) {
      assert.ok(contrast(brand.colors.primaryEmphasis.dark, bg) >= AA_TEXT, `on ${bg}`);
    }
  });

  test("the dark stylesheet agrees with brand.config about brand-as-text", () => {
    assert.equal(
      cssVar(GLOBALS, "--primary-emphasis", DARK_BLOCK),
      brand.colors.primaryEmphasis.dark.toLowerCase(),
    );
  });

  test("the focus ring is visible against the page (3:1 non-text)", () => {
    assert.ok(contrast(brand.colors.primary, cssVar(TOKENS, "--background")) >= AA_UI);
  });

  test("muted text clears AA on the page and on muted surfaces, both themes", () => {
    for (const bg of ["--background", "--muted", "--card"]) {
      assert.ok(contrast(cssVar(TOKENS, "--muted-foreground"), cssVar(TOKENS, bg)) >= AA_TEXT, bg);
      assert.ok(
        contrast(
          cssVar(GLOBALS, "--muted-foreground", DARK_BLOCK),
          cssVar(GLOBALS, bg, DARK_BLOCK),
        ) >= AA_TEXT,
        `dark ${bg}`,
      );
    }
  });
});

describe("platform look v0.2 — status pills", () => {
  for (const tone of ["ok", "warn", "err", "info", "neutral"] as const) {
    test(`${tone}: text on its pill clears AA, light and dark`, () => {
      const light = contrast(
        cssVar(TOKENS, `--status-${tone}-fg`),
        cssVar(TOKENS, `--status-${tone}-bg`),
      );
      const dark = contrast(
        cssVar(GLOBALS, `--status-${tone}-fg`, DARK_BLOCK),
        cssVar(GLOBALS, `--status-${tone}-bg`, DARK_BLOCK),
      );
      assert.ok(light >= AA_TEXT, `light ${light.toFixed(2)}:1`);
      assert.ok(dark >= AA_TEXT, `dark ${dark.toFixed(2)}:1`);
    });
  }

  test("the accent pill (brand on accent-subtle) clears AA, light and dark", () => {
    const p = brand.colors.primary.toLowerCase();
    const light = mix(p, cssVar(TOKENS, "--card"), 0.12);
    const dark = mix(p, cssVar(GLOBALS, "--card", DARK_BLOCK), 0.12);
    assert.ok(contrast(brand.colors.primaryEmphasis.light, light) >= AA_TEXT);
    assert.ok(contrast(brand.colors.primaryEmphasis.dark, dark) >= AA_TEXT);
  });
});

describe("platform look v0.2 — chart series survive both grounds", () => {
  // Recharts bakes a static fill, so one value must read on both themes.
  const LIGHT_PAGE = cssVar(TOKENS, "--background");
  const DARK_CARD = cssVar(GLOBALS, "--card", DARK_BLOCK);
  for (const [i, colour] of chartPalette.entries()) {
    test(`series ${i + 1} (${colour}) clears 3:1 on the light page and the dark card`, () => {
      assert.ok(contrast(colour, LIGHT_PAGE) >= AA_UI, `light ${contrast(colour, LIGHT_PAGE)}`);
      assert.ok(contrast(colour, DARK_CARD) >= AA_UI, `dark ${contrast(colour, DARK_CARD)}`);
    });
  }

  test("series 1 is the platform teal family, and no two series repeat", () => {
    assert.equal(chartPalette[0].toLowerCase(), "#12877d");
    assert.equal(new Set(chartPalette.map((c) => c.toLowerCase())).size, chartPalette.length);
  });
});
