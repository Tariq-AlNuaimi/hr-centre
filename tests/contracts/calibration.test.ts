import { test } from "node:test";
import assert from "node:assert/strict";
import {
  successScore,
  pearson,
  competencySignal,
  fitSummary,
  selectionRates,
  buildCalibration,
  MIN_OUTCOMES_FOR_REPORT,
  type CalibrationPair,
  type OutcomeInput,
} from "../../lib/calibration";

// Pure calibration math (ARCHITECTURE §7). These lock the advisory loop: the 0..1
// success blend, Pearson correlation, per-competency signal + suggestion, the
// 4/5ths selection-rate rule, and the insufficient-data gate. No DB, no service.

const outcome = (o: Partial<OutcomeInput>): OutcomeInput => ({
  hired: true,
  probationPassed: null,
  rating6m: null,
  rating12m: null,
  retained: null,
  ...o,
});

// ---- successScore ----

test("successScore returns null for a non-hired candidate (not a performance datapoint)", () => {
  assert.equal(successScore(outcome({ hired: false, retained: true })), null);
});

test("successScore returns null for a hire with no recorded post-hire signal", () => {
  assert.equal(successScore(outcome({ hired: true })), null);
});

test("successScore blends retained/probation/rating, weight-normalized over present signals", () => {
  // All present, all best: retained=1, probation=1, ratings (5,5)->1 → 1.0
  assert.equal(successScore(outcome({ retained: true, probationPassed: true, rating6m: 5, rating12m: 5 })), 1);
  // All present, all worst → 0
  assert.equal(successScore(outcome({ retained: false, probationPassed: false, rating6m: 1, rating12m: 1 })), 0);
  // Only retained recorded → normalizes to just that signal
  assert.equal(successScore(outcome({ retained: true })), 1);
  assert.equal(successScore(outcome({ retained: false })), 0);
});

test("successScore maps a 1..5 rating to 0..1 and clamps out-of-range", () => {
  // rating only, rating 3 → (3-1)/4 = 0.5
  assert.equal(successScore(outcome({ rating6m: 3 })), 0.5);
  // out-of-range rating clamps into [0,1]
  assert.equal(successScore(outcome({ rating6m: 9 })), 1);
  assert.equal(successScore(outcome({ rating6m: 0 })), 0);
});

test("successScore weighting: retained(0.4) dominates probation(0.3) when they disagree", () => {
  // retained=1 (w .4), probation=0 (w .3) → 0.4/0.7 ≈ 0.5714
  assert.equal(successScore(outcome({ retained: true, probationPassed: false })), 0.5714);
});

// ---- pearson ----

test("pearson is +1 for perfectly increasing, -1 for decreasing, 0 for <2 or flat", () => {
  assert.equal(pearson([{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }]), 1);
  assert.equal(pearson([{ x: 1, y: 6 }, { x: 2, y: 4 }, { x: 3, y: 2 }]), -1);
  assert.equal(pearson([{ x: 1, y: 1 }]), 0); // <2 pairs
  assert.equal(pearson([{ x: 1, y: 5 }, { x: 2, y: 5 }]), 0); // flat y → no NaN leak
});

// ---- competencySignal ----

function pair(fit: number, success: OutcomeInput, comps: { name: string; score: number; band: "PASS" | "PARTIAL" | "BELOW" }[]): CalibrationPair {
  return { fitScore: fit, competencies: comps, outcome: success };
}

test("competencySignal: PASS hires clearly out-performing BELOW hires → hold", () => {
  // Resilience: PASS candidates succeed (retained), BELOW candidates fail.
  const pairs: CalibrationPair[] = [
    pair(80, outcome({ retained: true }), [{ name: "Resilience", score: 85, band: "PASS" }]),
    pair(78, outcome({ retained: true }), [{ name: "Resilience", score: 82, band: "PASS" }]),
    pair(75, outcome({ retained: true }), [{ name: "Resilience", score: 80, band: "PASS" }]),
    pair(40, outcome({ retained: false }), [{ name: "Resilience", score: 30, band: "BELOW" }]),
    pair(42, outcome({ retained: false }), [{ name: "Resilience", score: 35, band: "BELOW" }]),
  ];
  const [sig] = competencySignal(pairs);
  assert.equal(sig.name, "Resilience");
  assert.equal(sig.n, 5);
  assert.ok(sig.r > 0.3, `expected strong positive r, got ${sig.r}`);
  assert.equal(sig.meanSuccessPass, 1);
  assert.equal(sig.meanSuccessBelow, 0);
  assert.equal(sig.gap, 1);
  assert.equal(sig.suggestion, "hold");
});

test("competencySignal: BELOW hires do as well as PASS hires → lower (band too strict)", () => {
  const pairs: CalibrationPair[] = [
    pair(80, outcome({ retained: true }), [{ name: "Detail", score: 85, band: "PASS" }]),
    pair(78, outcome({ retained: true }), [{ name: "Detail", score: 82, band: "PASS" }]),
    pair(40, outcome({ retained: true }), [{ name: "Detail", score: 30, band: "BELOW" }]),
    pair(42, outcome({ retained: true }), [{ name: "Detail", score: 35, band: "BELOW" }]),
  ];
  const [sig] = competencySignal(pairs);
  assert.equal(sig.gap, 0); // both groups fully retained
  assert.equal(sig.suggestion, "lower");
});

test("competencySignal: strong score→success correlation outranks a narrow gap → raise, never lower", () => {
  // Within-band variance drives a positive r while the PASS/BELOW means tie (gap≈0).
  // The precedence rule must pick `raise` (score discriminates), NOT `lower`.
  const pairs: CalibrationPair[] = [
    pair(10, outcome({ retained: false }), [{ name: "Drive", score: 10, band: "BELOW" }]),
    pair(40, outcome({ retained: true }), [{ name: "Drive", score: 40, band: "BELOW" }]),
    pair(60, outcome({ retained: false }), [{ name: "Drive", score: 60, band: "PASS" }]),
    pair(90, outcome({ retained: true }), [{ name: "Drive", score: 90, band: "PASS" }]),
  ];
  const [sig] = competencySignal(pairs);
  assert.equal(sig.gap, 0); // PASS mean (0.5) == BELOW mean (0.5)
  assert.ok(sig.r >= 0.3, `expected positive r, got ${sig.r}`);
  assert.equal(sig.suggestion, "raise");
});

test("competencySignal: one side of the band empty → insufficient", () => {
  const pairs: CalibrationPair[] = [
    pair(80, outcome({ retained: true }), [{ name: "Drive", score: 85, band: "PASS" }]),
    pair(78, outcome({ retained: false }), [{ name: "Drive", score: 82, band: "PASS" }]),
  ];
  const [sig] = competencySignal(pairs);
  assert.equal(sig.meanSuccessBelow, null);
  assert.equal(sig.gap, null);
  assert.equal(sig.suggestion, "insufficient");
});

test("competencySignal excludes non-hired and signal-less pairs", () => {
  const pairs: CalibrationPair[] = [
    pair(80, outcome({ retained: true }), [{ name: "Drive", score: 85, band: "PASS" }]),
    pair(70, outcome({ hired: false }), [{ name: "Drive", score: 60, band: "PARTIAL" }]),
    pair(70, outcome({ hired: true }), [{ name: "Drive", score: 60, band: "PARTIAL" }]), // no signal
  ];
  const [sig] = competencySignal(pairs);
  assert.equal(sig.n, 1); // only the first pair is success-scored
});

// ---- fitSummary ----

test("fitSummary correlates predicted fit with observed success over scored pairs only", () => {
  const pairs: CalibrationPair[] = [
    pair(90, outcome({ retained: true }), []),
    pair(50, outcome({ retained: false }), []),
    pair(60, outcome({ hired: false }), []), // excluded
  ];
  const fs = fitSummary(pairs);
  assert.equal(fs.n, 2);
  assert.equal(fs.points.length, 2);
  assert.equal(fs.r, 1); // higher fit → higher success
  assert.equal(fs.meanFit, 70);
  assert.equal(fs.meanSuccess, 0.5);
});

// ---- selectionRates (4/5ths rule) ----

test("selectionRates flags a group below 80% of the highest selection rate", () => {
  const rows = [
    { group: "Sales", selected: true, passed: true },
    { group: "Sales", selected: true, passed: true },
    { group: "Sales", selected: true, passed: false },
    { group: "Sales", selected: true, passed: true }, // 4/4 selected = 1.0
    { group: "PMO", selected: true, passed: true },
    { group: "PMO", selected: false, passed: false },
    { group: "PMO", selected: false, passed: false },
    { group: "PMO", selected: false, passed: false }, // 1/4 = 0.25 < 0.8 → flag
  ];
  const out = selectionRates(rows);
  const sales = out.find((r) => r.group === "Sales")!;
  const pmo = out.find((r) => r.group === "PMO")!;
  assert.equal(sales.selectionRate, 1);
  assert.equal(sales.adverseFlag, false);
  assert.equal(pmo.selectionRate, 0.25);
  assert.equal(pmo.adverseFlag, true);
});

test("selectionRates does not flag when all groups are comparable", () => {
  const rows = [
    { group: "A", selected: true, passed: true },
    { group: "A", selected: false, passed: false },
    { group: "B", selected: true, passed: true },
    { group: "B", selected: false, passed: false },
  ];
  assert.ok(selectionRates(rows).every((r) => !r.adverseFlag));
});

// ---- buildCalibration (insufficient-data gate) ----

test("buildCalibration returns insufficient below the minimum, with honest counts", () => {
  const pairs: CalibrationPair[] = Array.from({ length: 3 }, () =>
    pair(80, outcome({ retained: true }), [{ name: "Drive", score: 80, band: "PASS" }])
  );
  const out = buildCalibration(pairs);
  assert.equal(out.kind, "insufficient");
  if (out.kind === "insufficient") {
    assert.equal(out.have, 3);
    assert.equal(out.need, MIN_OUTCOMES_FOR_REPORT);
  }
});

test("buildCalibration produces a report at/above the minimum, counting only scored pairs", () => {
  const scored: CalibrationPair[] = Array.from({ length: MIN_OUTCOMES_FOR_REPORT }, (_, i) =>
    pair(70 + i, outcome({ retained: i % 2 === 0 }), [{ name: "Drive", score: 70 + i, band: "PASS" }])
  );
  // Add non-scored noise that must NOT count toward the sample size.
  const noise: CalibrationPair[] = [pair(50, outcome({ hired: false }), [])];
  const out = buildCalibration([...scored, ...noise]);
  assert.equal(out.kind, "ok");
  if (out.kind === "ok") {
    assert.equal(out.report.sampleSize, MIN_OUTCOMES_FOR_REPORT);
    assert.equal(out.report.fit.n, MIN_OUTCOMES_FOR_REPORT);
  }
});
