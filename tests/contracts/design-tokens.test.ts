import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brand } from "../../brand.config";

// app/tokens.css (plain-CSS land) is the ruler these assertions lock against.
// The two overlapping numeric tokens the deleted AntD theme file once exported
// (components/layout/antd-theme.ts, removed in C4/ADR-029) are inlined here so
// the lockstep still bites: borderRadius derives from brand.radius and the base
// fontSize is 14px. Same pattern as SCRUB_FIELDS + its membership test.
const brandTokens = { borderRadius: brand.radius, fontSize: 14 };

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

// --- Semantic surface layer (ADR-029, Workstream C2) -----------------------
// The shadcn primitive layer paints off ONE set of semantic vars, and dark mode
// is a single variable swap. These assertions lock that contract: each var is
// defined in :root, mapped to a --color-* utility, and overridden under
// [data-theme="dark"] -- so a `dark:` pair can never silently creep back in.
const SEMANTIC_VARS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--muted",
  "--muted-foreground",
  "--border",
  "--input",
  "--destructive",
  "--destructive-emphasis",
  "--primary-emphasis",
  "--ring",
];

test("tokens.css defines every semantic surface var in :root", () => {
  for (const v of SEMANTIC_VARS) {
    assert.match(tokensCss, new RegExp(`${v}:\\s*[^;]+;`), `tokens.css defines ${v}`);
  }
});

test("@theme maps each semantic var to a --color-* utility", () => {
  for (const c of [
    "--color-background",
    "--color-foreground",
    "--color-card",
    "--color-muted",
    "--color-muted-foreground",
    "--color-border",
    "--color-input",
    "--color-ring",
    "--color-destructive",
    "--color-destructive-emphasis",
    "--color-primary-emphasis",
  ]) {
    assert.match(
      tokensCss,
      new RegExp(`${c}:\\s*var\\(`),
      `@theme block maps ${c} to a var()`,
    );
  }
});

// Every semantic surface that DIFFERS between light and dark must be re-declared
// under [data-theme="dark"] — a single missing override is a silently-wrong dark
// surface. This guards the full set so a dropped override fails the suite (the
// coverage gap the senior review flagged: card-foreground/muted-foreground/
// destructive were unguarded). `--ring` is deliberately excluded: it resolves to
// var(--brand-primary), a mode-agnostic brand color that is NOT dark-swapped, so
// asserting a dark override for it would be wrong.
const DARK_OVERRIDDEN = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--muted",
  "--muted-foreground",
  "--border",
  "--input",
  "--destructive",
  // Split emphasis tokens (Workstream D): brand-as-text and red-as-text each get
  // a lighter dark value so they clear AA on the dark shell, while the brand/red
  // SURFACES (--ring stays brand, --destructive is the button bg) are unchanged.
  // A dropped dark override here silently regresses text contrast in dark mode.
  "--destructive-emphasis",
  "--primary-emphasis",
];
test("dark mode overrides every mode-varying semantic surface in globals.css", () => {
  for (const v of DARK_OVERRIDDEN) {
    assert.match(
      globalsCss,
      // The trailing colon in `${v}:` already disambiguates `--card` from
      // `--card-foreground` (the latter has `-foreground`, not `:`, after `--card`).
      new RegExp(`\\[data-theme="dark"\\][\\s\\S]*?${v}:\\s*[^;]+;`),
      `globals.css dark block overrides ${v}`,
    );
  }
});
