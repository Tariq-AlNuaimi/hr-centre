// Contract tests for the docs-site enabler (scripts/enable-docs-site.mjs, ADR-053).
// Run on every `npm test` / `/ship`, locally and DB-free.
//
// Two contracts:
//  1. `--dry-run` plans every template write + config patch and touches nothing.
//  2. Anchor drift: the enabler patches configs via anchored string edits. If a
//     config still lacks the fumadocs marker (pristine template), it MUST contain
//     the anchor the patch targets — otherwise a template refactor silently broke
//     the enabler and it would fail at the fork's enable time, not here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(ROOT, "scripts", "enable-docs-site.mjs");
const TEMPLATE_DIR = path.join(ROOT, "scripts", "templates", "docs-site");

function runEnabler(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

// The full emitted surface (blueprint Scope) — one .tpl per target file.
const EXPECTED_FILES = [
  "source.config.ts",
  path.join("app", "[locale]", "docs", "[[...slug]]", "page.tsx"),
  path.join("app", "[locale]", "docs", "layout.tsx"),
  path.join("app", "api", "docs-search", "route.ts"),
  path.join("app", "fumadocs-tokens.css"),
  path.join("lib", "docs", "source.ts"),
  path.join("lib", "docs", "mdx-components.tsx"),
  path.join("content", "docs", "index.mdx"),
  path.join("content", "docs", "adding-pages.mdx"),
];

test("every emitted file has a byte-source .tpl in scripts/templates/docs-site", () => {
  for (const rel of EXPECTED_FILES) {
    assert.ok(existsSync(path.join(TEMPLATE_DIR, `${rel}.tpl`)), `missing template ${rel}.tpl`);
  }
});

test("dry-run: plans all writes + patches + install, exits 0", () => {
  const { code, stdout } = runEnabler(["--dry-run"]);
  assert.equal(code, 0, "dry-run should exit 0");
  for (const rel of EXPECTED_FILES) {
    assert.ok(stdout.includes(`write ${rel}`), `expected a planned write for ${rel}`);
  }
  for (const cfg of ["next.config.ts", "tsconfig.json", "app/globals.css", "knip.json"]) {
    assert.ok(stdout.includes(`patch ${cfg}`), `expected a planned patch for ${cfg}`);
  }
  assert.match(stdout, /patch package\.json/);
  assert.match(stdout, /fumadocs-ui@/);
});

test("dry-run writes nothing", () => {
  // In the pristine template none of the emitted files exist; in an enabled fork
  // they all do. Snapshot existence before, assert unchanged after.
  const before = EXPECTED_FILES.map((rel) => existsSync(path.join(ROOT, rel)));
  runEnabler(["--dry-run"]);
  EXPECTED_FILES.forEach((rel, i) => {
    assert.equal(
      existsSync(path.join(ROOT, rel)),
      before[i],
      `dry-run must not create or delete ${rel}`,
    );
  });
});

// Anchor-drift contract: for each patched config, either the fumadocs marker is
// already present (enabled fork) or the anchor the patch targets must exist.
const ANCHOR_CONTRACT: Array<{ rel: string; marker: string; anchors: string[] }> = [
  {
    rel: "next.config.ts",
    marker: "fumadocs-mdx/next",
    anchors: [
      'import createNextIntlPlugin from "next-intl/plugin";',
      "const baseConfig = withAnalyzer(withNextIntl(nextConfig));",
    ],
  },
  {
    rel: "tsconfig.json",
    marker: '"collections/*"',
    anchors: ['"@/*": ["./*"]'],
  },
  {
    rel: "app/globals.css",
    marker: "BEGIN fumadocs",
    anchors: ['@import "./tokens.css";'],
  },
  {
    rel: "knip.json",
    marker: "source.config.ts",
    anchors: ['"brand.config.ts"'],
  },
];

for (const { rel, marker, anchors } of ANCHOR_CONTRACT) {
  test(`anchor drift: ${rel} is patchable (or already patched)`, () => {
    const text = readFileSync(path.join(ROOT, rel), "utf8");
    if (text.includes(marker)) return; // enabled fork — patch already applied
    for (const anchor of anchors) {
      assert.ok(
        text.includes(anchor),
        `${rel} lost the anchor ${JSON.stringify(anchor)} — update scripts/enable-docs-site.mjs ` +
          `(and this test) to match the new shape`,
      );
    }
  });
}
