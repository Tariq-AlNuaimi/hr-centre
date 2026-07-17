#!/usr/bin/env node
// scripts/visual-regression.mjs — the visual-regression differ (V2-308).
//
// The visual-iteration loop (V2-301) produces a PNG matrix per feature under
// docs/verification/<feature>/ via `scripts/capture-screens.mjs`. This is the gate ON
// that output: it diffs a committed BASELINE set against a freshly-captured CURRENT set,
// per image, pixel-for-pixel, and FAILS on any regression beyond a small tolerance — so a
// stray 4px misalignment (or a color/spacing drift) surfaces as a red diff instead of
// slipping through review. Built on pixelmatch + pngjs (what Lost Pixel/Playwright use
// internally); no SaaS, no second capture stack — it reuses the harness this repo owns.
//
// Wired to QA time (`/design-qa` / `npm run uat:full`), NOT the warm `/ship` loop — a
// pixel diff needs a running app + a captured set, which the fast pre-push gate doesn't do.
//
// Usage:
//   node scripts/visual-regression.mjs --baseline docs/verification/<feat>/baseline \
//        --current docs/verification/<feat> [--max-diff-ratio 0.001] [--threshold 0.1]
// Exit 0 = every image within tolerance; exit 1 = at least one regression (a *.diff.png is
// written next to each offender for review).
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

/**
 * Compare two PNG buffers. Returns { diffPixels, totalPixels, ratio, dimensionMismatch,
 * width, height, diff (a PNG or null), pass }. A dimension change is always a regression
 * (the layout reflowed the canvas). `pass` = within tolerance.
 *   - threshold: pixelmatch per-pixel color sensitivity (0 strict … 1 lax).
 *   - maxDiffRatio: fraction of pixels allowed to differ before it's a regression.
 */
export function compareImages(
  baselineBuf,
  currentBuf,
  { threshold = 0.1, maxDiffRatio = 0.001 } = {},
) {
  const a = PNG.sync.read(baselineBuf);
  const b = PNG.sync.read(currentBuf);
  if (a.width !== b.width || a.height !== b.height) {
    return {
      diffPixels: Infinity,
      totalPixels: a.width * a.height,
      ratio: 1,
      dimensionMismatch: true,
      width: a.width,
      height: a.height,
      diff: null,
      pass: false,
    };
  }
  const { width, height } = a;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(a.data, b.data, diff.data, width, height, { threshold });
  const totalPixels = width * height;
  const ratio = totalPixels ? diffPixels / totalPixels : 0;
  return {
    diffPixels,
    totalPixels,
    ratio,
    dimensionMismatch: false,
    width,
    height,
    diff,
    pass: ratio <= maxDiffRatio,
  };
}

// --- CLI ---------------------------------------------------------------------
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const baselineDir = arg("baseline");
  const currentDir = arg("current");
  if (!baselineDir || !currentDir) {
    console.error(
      "usage: visual-regression.mjs --baseline <dir> --current <dir> [--max-diff-ratio 0.001] [--threshold 0.1]",
    );
    process.exit(2);
  }
  const maxDiffRatio = Number(arg("max-diff-ratio", "0.001"));
  const threshold = Number(arg("threshold", "0.1"));
  if (!existsSync(baselineDir)) {
    console.error(
      `visual-regression: no baseline dir '${baselineDir}' — capture a baseline first.`,
    );
    process.exit(2);
  }
  const outDir = arg("out", path.join(currentDir, "__diff"));
  const baselines = readdirSync(baselineDir).filter((f) => f.endsWith(".png"));
  if (baselines.length === 0) {
    console.error(`visual-regression: baseline dir '${baselineDir}' has no .png files.`);
    process.exit(2);
  }
  const regressions = [];
  const missing = [];
  for (const name of baselines) {
    const currentPath = path.join(currentDir, name);
    if (!existsSync(currentPath)) {
      missing.push(name);
      continue;
    }
    const res = compareImages(
      readFileSync(path.join(baselineDir, name)),
      readFileSync(currentPath),
      {
        threshold,
        maxDiffRatio,
      },
    );
    if (!res.pass) {
      if (res.diff) {
        mkdirSync(outDir, { recursive: true });
        writeFileSync(
          path.join(outDir, name.replace(/\.png$/, ".diff.png")),
          PNG.sync.write(res.diff),
        );
      }
      regressions.push({ name, res });
    }
  }
  console.log(
    `visual-regression: ${baselines.length} baseline(s), ${regressions.length} regression(s), ${missing.length} missing.`,
  );
  for (const { name, res } of regressions) {
    console.error(
      res.dimensionMismatch
        ? `  REGRESSION ${name}: dimensions changed (baseline ${res.width}x${res.height})`
        : `  REGRESSION ${name}: ${res.diffPixels} px differ (${(res.ratio * 100).toFixed(3)}% > ${(maxDiffRatio * 100).toFixed(3)}%) — diff at ${path.join(outDir, name.replace(/\.png$/, ".diff.png"))}`,
    );
  }
  for (const name of missing)
    console.error(`  MISSING  ${name}: no current capture (did the route change?)`);
  process.exit(regressions.length > 0 || missing.length > 0 ? 1 : 0);
}
