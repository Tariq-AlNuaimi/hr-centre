import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brandTokens } from "../../components/layout/antd-theme";
import { brand } from "../../brand.config";

// app/tokens.css (plain-CSS land) and components/layout/antd-theme.ts (AntD
// land) describe the same ruler. These assertions keep them in lockstep --
// the same pattern as SCRUB_FIELDS + its membership test.

const root = join(import.meta.dirname, "..", "..");
const tokensCss = readFileSync(join(root, "app", "tokens.css"), "utf8");
const globalsCss = readFileSync(join(root, "app", "globals.css"), "utf8");
const localeLayout = readFileSync(
  join(root, "app", "[locale]", "layout.tsx"),
  "utf8",
);

function cssVar(name: string): string {
  const m = tokensCss.match(new RegExp(`${name}:\\s*([^;]+);`));
  assert.ok(m, `tokens.css should define ${name}`);
  return m[1].trim();
}

test("tokens.css --radius-base matches AntD borderRadius", () => {
  assert.equal(cssVar("--radius-base"), `${brandTokens.borderRadius}px`);
});

test("tokens.css --font-size-base matches AntD fontSize", () => {
  assert.equal(cssVar("--font-size-base"), `${brandTokens.fontSize}px`);
});

// next/font requires a LITERAL `variable` value, so app/[locale]/layout.tsx
// can't reference brand.font.cssVar directly — the two must be kept in lockstep
// by hand. This asserts the literal in layout matches the config, so the AntD
// fontFamily token (which DOES derive from brand.font.cssVar) actually resolves
// the loaded font instead of falling through to the system fallback silently.
test("next/font variable in layout matches brand.font.cssVar", () => {
  assert.match(
    localeLayout,
    new RegExp(`variable:\\s*"${brand.font.cssVar}"`),
    `app/[locale]/layout.tsx must load the font into "${brand.font.cssVar}"`,
  );
});

test("every --space-* step sits on the 4px scale", () => {
  const steps = [...tokensCss.matchAll(/--space-\d+:\s*(\d+)px;/g)];
  assert.ok(steps.length >= 8, "spacing scale should have at least 8 steps");
  for (const [decl, px] of steps) {
    assert.equal(Number(px) % 4, 0, `${decl} is off the 4px scale`);
  }
});

test("every --density-* semantic resolves to a --space-* step", () => {
  const semantics = [...tokensCss.matchAll(/--density-[\w-]+:\s*([^;]+);/g)];
  assert.ok(semantics.length >= 4, "expected the four density semantics");
  for (const [decl, value] of semantics) {
    assert.match(value.trim(), /^var\(--space-\d+\)$/, `${decl} must point at the spacing scale`);
  }
});

test("globals.css imports tokens.css so the scale is actually loaded", () => {
  assert.match(globalsCss, /@import\s+"\.\/tokens\.css";/);
});
