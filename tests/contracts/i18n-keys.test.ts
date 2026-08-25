import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every `t("…")` key a component asks for must exist in BOTH locales.
 *
 * This exists because a wrong namespace is invisible to every other gate. A
 * component written as `useTranslations("pms.goalSetting")` that reads keys
 * living under `pms.kpi` type-checks, lints, builds, renders, and passes axe —
 * next-intl's fallback is to print the key itself, so the page comes up showing
 * `pms.goalSetting.signOffTitle` where a heading should be. It was found by
 * looking at a screenshot, which is not a repeatable way to find it.
 *
 * Three real bugs on the first run: two sign-off components on the wrong
 * namespace, and `common.noResults` — asked for by the people directory since
 * Phase 1, never defined, so filtering the list to nothing showed the raw key.
 *
 * The scan is deliberately literal: it resolves `const x = useTranslations("ns")`
 * to `x("key")` calls in the same file. Computed namespaces and fully dynamic
 * keys are out of reach, but a template literal's static prefix is checked as a
 * subtree, which covers the `t(`party.${party}`)` shape the PMS screens use.
 */

// Every bundle the repo actually ships, not a hardcoded pair. `project.config.json`
// may route only a subset of them (this fork is English-only today), but a
// maintained-but-unrouted bundle is exactly the one that rots — enabling a
// locale should be a config flip, not a translation project.
const LOCALES = readdirSync("messages")
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();
const messages: Record<string, unknown> = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(`messages/${l}.json`, "utf8")) as unknown]),
);

const lookup = (bundle: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined,
      bundle,
    );

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

type Ask = { file: string; path: string; kind: "message" | "subtree" };

function asksIn(file: string): Ask[] {
  const src = readFileSync(file, "utf8");
  const namespaces = new Map<string, string>();
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*useTranslations\(\s*"([^"]+)"\s*\)/g)) {
    namespaces.set(m[1], m[2]);
  }
  if (namespaces.size === 0) return [];

  const asks: Ask[] = [];
  for (const m of src.matchAll(/\b(\w+)\(\s*"([A-Za-z][\w.]*)"/g)) {
    const ns = namespaces.get(m[1]);
    if (ns) asks.push({ file, path: `${ns}.${m[2]}`, kind: "message" });
  }
  // t(`party.${party}`) — the static prefix must at least name a subtree.
  for (const m of src.matchAll(/\b(\w+)\(\s*`([^`$]*)\$\{/g)) {
    const ns = namespaces.get(m[1]);
    if (ns && m[2]) asks.push({ file, path: `${ns}.${m[2].replace(/\.$/, "")}`, kind: "subtree" });
  }
  return asks;
}

const asks = ["components", "app"].flatMap((dir) => sourceFiles(dir).flatMap(asksIn));

test("there is at least one locale bundle to check against", () => {
  assert.ok(LOCALES.length > 0, "no messages/*.json found — the scan would pass vacuously");
});

test("the scan actually found the translation calls it is meant to guard", () => {
  // A regex that silently stops matching would turn this whole file green.
  assert.ok(asks.length > 100, `expected the PMS + template screens, found ${asks.length} asks`);
});

for (const locale of LOCALES) {
  test(`every t() key resolves in ${locale}`, () => {
    const missing = asks.filter(({ path, kind }) => {
      const value = lookup(messages[locale], path);
      return kind === "message" ? typeof value !== "string" : typeof value !== "object";
    });
    assert.deepEqual(
      missing.map((m) => `${m.file}: ${m.path}`),
      [],
      "next-intl renders a missing key as the key itself — this is what ships to the screen",
    );
  });
}
