import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brand } from "../../brand.config";

// The Rihal design system is CSS-first (Tailwind v4): the locked brand tokens
// (UI-SPEC Part A) live in app/globals.css and everything derives from them.
// These assertions keep the token source honest -- the same lockstep discipline
// as SCRUB_FIELDS + its membership test.

const root = join(import.meta.dirname, "..", "..");
const globalsCss = readFileSync(join(root, "app", "globals.css"), "utf8");
const localeLayout = readFileSync(
  join(root, "app", "[locale]", "layout.tsx"),
  "utf8",
);

// UI-SPEC A.2 — the locked brand palette. Every one must be declared.
const BRAND_TOKENS = [
  "--rihal-ink",
  "--rihal-deep",
  "--rihal-azure",
  "--rihal-mist",
  "--rihal-paper",
  "--rihal-sand",
  "--signal-pass",
  "--signal-partial",
  "--signal-below",
  "--rihal-line",
];

test("globals.css declares every locked brand token (UI-SPEC A.2)", () => {
  for (const token of BRAND_TOKENS) {
    assert.match(
      globalsCss,
      new RegExp(`${token}:\\s*#?[\\w(),.\\s-]+;`),
      `globals.css must declare ${token}`,
    );
  }
});

test("globals.css maps brand tokens into the Tailwind @theme (so utilities exist)", () => {
  assert.match(globalsCss, /@theme inline\s*\{/);
  for (const token of ["rihal-azure", "signal-pass", "signal-below"]) {
    assert.match(
      globalsCss,
      new RegExp(`--color-${token}:\\s*var\\(--${token}\\);`),
      `@theme must expose --color-${token}`,
    );
  }
});

test("globals.css defines the radius scale root (UI-SPEC A.4)", () => {
  assert.match(globalsCss, /--radius:\s*[\d.]+rem;/);
});

test("globals.css imports Tailwind v4", () => {
  assert.match(globalsCss, /@import\s+"tailwindcss";/);
});

// A.3 — the three faces (Inter UI/data, Sora display, IBM Plex Sans Arabic) must
// be loaded by next/font in the locale layout into the vars @theme reads.
test("locale layout loads the three brand font variables (UI-SPEC A.3)", () => {
  for (const cssVar of ["--font-inter", "--font-sora", "--font-plex-arabic"]) {
    assert.match(
      localeLayout,
      new RegExp(`variable:\\s*"${cssVar}"`),
      `layout must load a font into "${cssVar}"`,
    );
  }
});

test("brand.config primary/accent are the Rihal brand hexes", () => {
  assert.equal(brand.colors.primary.toLowerCase(), "#123047");
  assert.equal(brand.colors.accent.toLowerCase(), "#2e7da6");
});
