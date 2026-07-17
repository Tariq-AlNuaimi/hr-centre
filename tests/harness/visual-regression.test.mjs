// Unit coverage for the V2-308 visual-regression differ (scripts/visual-regression.mjs).
//
// The accept criterion: a baseline + a deliberate 4px misalignment produces a red diff.
// These tests prove it deterministically with synthetic PNGs (no app/DB needed): an
// identical capture passes, a 4px-shifted block fails, and a dimension change fails. This
// is the negative-test evidence the harness requires of every gate.
//
// Run via `npm run test:hooks` (node --test tests/harness/*.test.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { compareImages } from "../../scripts/visual-regression.mjs";

const W = 80;
const H = 40;

// A white canvas with a filled black rectangle [x, x+16) × [10, 30). `x` lets us shift it.
function canvasWithBlock(x) {
  const png = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let px = 0; px < W; px++) {
      const idx = (y * W + px) << 2;
      const inBlock = px >= x && px < x + 16 && y >= 10 && y < 30;
      const v = inBlock ? 0 : 255;
      png.data[idx] = v; // R
      png.data[idx + 1] = v; // G
      png.data[idx + 2] = v; // B
      png.data[idx + 3] = 255; // A
    }
  }
  return PNG.sync.write(png);
}

test("visual-regression: an identical capture PASSES (0 diff)", () => {
  const baseline = canvasWithBlock(20);
  const current = canvasWithBlock(20);
  const res = compareImages(baseline, current);
  assert.equal(res.diffPixels, 0, "identical images differ by 0 pixels");
  assert.equal(res.pass, true, "identical images pass");
});

test("visual-regression: a 4px misalignment FAILS (red diff)", () => {
  const baseline = canvasWithBlock(20);
  const shifted = canvasWithBlock(24); // the block moved 4px right — the accept case
  const res = compareImages(baseline, shifted);
  assert.ok(res.diffPixels > 0, "a 4px shift produces differing pixels");
  assert.equal(res.pass, false, "a 4px shift is a regression");
  // The shift exposes/hides two 4px-wide × 20px-tall edges → ~160 changed pixels, well
  // above the default 0.1% tolerance (≈3 px on this 80×40 canvas).
  assert.ok(res.diffPixels >= 100, `expected a substantial diff, got ${res.diffPixels}`);
  assert.ok(res.diff, "a diff image is produced for review");
});

test("visual-regression: a dimension change is always a regression", () => {
  const baseline = canvasWithBlock(20);
  const taller = PNG.sync.write(new PNG({ width: W, height: H + 8 }));
  const res = compareImages(baseline, taller);
  assert.equal(res.dimensionMismatch, true);
  assert.equal(res.pass, false, "a reflowed canvas fails");
});

test("visual-regression: maxDiffRatio tolerates sub-threshold noise", () => {
  // Flip a single pixel — 1/3200 ≈ 0.03%, under the 0.1% default tolerance → still passes.
  const baseline = canvasWithBlock(20);
  const noisy = PNG.sync.read(canvasWithBlock(20));
  noisy.data[0] = 128; // nudge one pixel's red channel
  const res = compareImages(baseline, PNG.sync.write(noisy));
  assert.ok(res.diffPixels >= 1, "one pixel changed");
  assert.equal(res.pass, true, "a single-pixel nudge is within the default tolerance");
});
