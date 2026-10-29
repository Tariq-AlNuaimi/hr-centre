import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  bandShareRows,
  emptyDistribution,
  feedbackTier,
  nineBox,
  performanceTier,
  tally,
} from "../../lib/pms/distribution";

/** P2-1 — calibration chart, prior cycle and 9-box (docs/blueprints/p2-performance.md). */

test("AC-1.1 band shares are percentages of headcount, one decimal, best band first", () => {
  const actual = tally(["OUTSTANDING", "TARGET", "TARGET"]);
  const rows = bandShareRows({ actual, headcount: 3, targetPct: null, prior: null });
  assert.deepEqual(
    rows.map((r) => r.band),
    ["OUTSTANDING", "EXCELLENT", "TARGET", "ALMOST_ACHIEVED", "UNSATISFACTORY"],
  );
  assert.equal(rows[0].actual, 33.3);
  assert.equal(rows[2].actual, 66.7);
  assert.equal(rows[0].target, null);
  assert.equal(rows[0].prior, null);
});

test("AC-1.1 worst path: an empty cycle draws zeros, never NaN", () => {
  const rows = bandShareRows({
    actual: emptyDistribution(),
    headcount: 0,
    targetPct: null,
    prior: { actual: emptyDistribution(), headcount: 0 },
  });
  for (const r of rows) {
    assert.equal(r.actual, 0);
    assert.equal(r.prior, 0);
  }
});

test("AC-1.2 target and prior-cycle shares ride alongside the actual", () => {
  const targetPct = { ...emptyDistribution(), TARGET: 60, EXCELLENT: 40 };
  const rows = bandShareRows({
    actual: tally(["TARGET"]),
    headcount: 1,
    targetPct,
    prior: { actual: tally(["EXCELLENT", "TARGET", "TARGET", "TARGET"]), headcount: 4 },
  });
  const target = rows.find((r) => r.band === "TARGET");
  assert.equal(target?.target, 60);
  assert.equal(target?.prior, 75);
});

test("AC-1.3 9-box tiers: calibrated band rows, 360 level columns", () => {
  assert.equal(performanceTier("OUTSTANDING"), "HIGH");
  assert.equal(performanceTier("EXCELLENT"), "HIGH");
  assert.equal(performanceTier("TARGET"), "MID");
  assert.equal(performanceTier("ALMOST_ACHIEVED"), "LOW");
  assert.equal(performanceTier("UNSATISFACTORY"), "LOW");
  assert.equal(feedbackTier(2.99), "LOW");
  assert.equal(feedbackTier(3), "MID");
  assert.equal(feedbackTier(3.99), "MID");
  assert.equal(feedbackTier(4), "HIGH");
});

test("AC-1.3 9-box returns all nine cells and never places someone with no 360", () => {
  const box = nineBox([
    { employeeId: "a", name: "Zed", calibratedBand: "OUTSTANDING", threeSixtyLevel: 4.5 },
    { employeeId: "b", name: "Amal", calibratedBand: "OUTSTANDING", threeSixtyLevel: 4.1 },
    { employeeId: "c", name: "Badr", calibratedBand: "UNSATISFACTORY", threeSixtyLevel: 1 },
    { employeeId: "d", name: "C-level", calibratedBand: "TARGET", threeSixtyLevel: null },
  ]);
  assert.equal(box.cells.length, 9);
  assert.equal(box.withoutFeedback, 1);
  const star = box.cells.find((c) => c.performance === "HIGH" && c.feedback === "HIGH");
  assert.equal(star?.count, 2);
  assert.deepEqual(
    star?.people.map((p) => p.name),
    ["Amal", "Zed"],
  );
  const total = box.cells.reduce((n, c) => n + c.count, 0);
  assert.equal(total, 3);
});

test("AC-1.4 the chart helpers stay client-safe (no Prisma runtime import)", () => {
  const src = readFileSync("lib/pms/distribution.ts", "utf8");
  assert.doesNotMatch(src, /^import \{[^}]*\} from "@\/generated\/prisma\/client"/m);
  assert.match(src, /^import type \{ Band \}/m);
});

test("AC-1.5 calibration GET returns prior cycle, 9-box and chart inputs; HR Super Admin only", () => {
  const src = readFileSync("app/api/calibration/route.ts", "utf8");
  assert.match(src, /priorBand:/);
  assert.match(src, /nineBox\(/);
  assert.match(src, /targetPctByBand/);
  assert.match(src, /year: \{ lt: year \}/);
  assert.match(src, /isHrSuperAdmin\(actor\)/);
});

test("AC-1.6 the distribution chart appears on calibration, the distribution report and executive", () => {
  for (const f of [
    "app/[locale]/(dashboard)/calibration/page.tsx",
    "components/pms/DistributionReport.tsx",
    "app/[locale]/(dashboard)/executive/page.tsx",
  ]) {
    assert.match(readFileSync(f, "utf8"), /<BandDistributionChart/, f);
  }
});
