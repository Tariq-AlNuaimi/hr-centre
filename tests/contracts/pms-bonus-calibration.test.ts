import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "../../generated/prisma/client";

import {
  DAYS_IN_YEAR,
  ELIGIBILITY_MONTHS,
  computeBonus,
  effectiveServiceMonths,
  inclusiveDays,
  isBonusEligible,
  workDays,
} from "../../lib/pms/bonus";
import {
  BANDS,
  adjustmentBlockedReason,
  calibrationReadinessBlockedReason,
  distributionGap,
  emptyDistribution,
  isCurveEligible,
  tally,
} from "../../lib/pms/calibration";
import type { PmsActor } from "../../lib/pms/permissions";

/** §10 calibration and §11 bonus. */

const CYCLE = { cycleStart: new Date("2027-01-01"), cycleEnd: new Date("2027-12-31") };
const base = {
  ...CYCLE,
  dateOfJoining: new Date("2020-01-01"),
  lastWorkingDay: null,
  unpaidLeaveDays: 0,
};

const actor = (over: Partial<PmsActor> = {}): PmsActor => ({
  userId: "u",
  employeeId: "e",
  pmsRoles: [],
  isLineManager: false,
  ...over,
});
const superAdmin = actor({ pmsRoles: ["HR_SUPER_ADMIN"] });
const hrbp = actor({ pmsRoles: ["HRBP"] });

// --- §11.4's day counting ------------------------------------------------------

test("§11.4 the divisor is 365, as payroll uses", () => {
  assert.equal(DAYS_IN_YEAR, 365);
});

test("a full year employed is 365 days", () => {
  assert.equal(workDays(base), 365);
  assert.equal(inclusiveDays(new Date("2027-01-01"), new Date("2027-12-31")), 365);
});

test("§11.4 a mid-year joiner runs from their joining date to year-end", () => {
  const days = workDays({ ...base, dateOfJoining: new Date("2027-07-01") });
  assert.equal(days, 184); // 1 Jul – 31 Dec inclusive
});

test("§11.4 a leaver runs from cycle start to their last working day", () => {
  const days = workDays({ ...base, lastWorkingDay: new Date("2027-06-30") });
  assert.equal(days, 181); // 1 Jan – 30 Jun inclusive
});

test("§11.4 unpaid leave comes off the work days", () => {
  assert.equal(workDays({ ...base, unpaidLeaveDays: 30 }), 335);
});

test("work days never go negative", () => {
  // More unpaid leave than days employed is a data problem; a negative bonus is
  // not how to report it.
  assert.equal(workDays({ ...base, unpaidLeaveDays: 500 }), 0);
});

// --- §11.2 / §11.5's eligibility gate --------------------------------------------

test("§11.2 the gate is six months of EFFECTIVE service", () => {
  assert.equal(ELIGIBILITY_MONTHS, 6);
  assert.equal(isBonusEligible(base), true);
});

test("§11.5 the spec's own example: 7 months employed, 2 unpaid → 5 effective → NOT eligible", () => {
  // "Someone employed 7 calendar months with 2 months unpaid leave has 5 months
  // effective service and does not clear the gate."
  const sevenMonths = { ...base, dateOfJoining: new Date("2027-06-01") }; // Jun–Dec
  assert.ok(
    effectiveServiceMonths(sevenMonths).greaterThanOrEqualTo(6),
    "7 months clears it alone",
  );

  const withLeave = { ...sevenMonths, unpaidLeaveDays: 61 }; // ~2 months
  const months = effectiveServiceMonths(withLeave);
  assert.ok(months.lessThan(6), `expected under 6 effective months, got ${months.toFixed(2)}`);
  assert.equal(isBonusEligible(withLeave), false);
});

test("a joiner in November does not clear the gate", () => {
  assert.equal(isBonusEligible({ ...base, dateOfJoining: new Date("2027-11-01") }), false);
});

// --- §11.3's coefficients and §11.4's pro-ration ------------------------------------

test("§11.3 / §11.4 the formula: coefficient × salary × (days ÷ 365)", () => {
  const r = computeBonus({ band: "OUTSTANDING", basicSalary: "1000", work: base });
  assert.equal(r.eligible, true);
  assert.equal(r.coefficient, 2);
  // 2.0 × 1000 × (365/365) = 2000.00
  assert.equal(r.amount, "2000.00");
});

test("§11.4 a mid-year joiner is pro-rated on calendar days", () => {
  const r = computeBonus({
    band: "TARGET",
    basicSalary: "1200",
    work: { ...base, dateOfJoining: new Date("2027-07-01") },
  });
  // 1.0 × 1200 × (184/365) = 604.93
  assert.equal(r.workDays, 184);
  assert.equal(r.amount, "604.93");
});

test("§11.3 the bottom two bands earn nothing, even when eligible", () => {
  for (const band of ["ALMOST_ACHIEVED", "UNSATISFACTORY"] as const) {
    const r = computeBonus({ band, basicSalary: "5000", work: base });
    assert.equal(r.eligible, true, "they are still eligible…");
    assert.equal(r.amount, "0.00", "…and still earn nothing");
  }
});

test("§11.7 an ineligible employee is returned WITH a reason, not omitted", () => {
  // "Ineligible employees are included and flagged (with reason: under 6
  // months), so nothing looks accidentally omitted."
  const r = computeBonus({
    band: "OUTSTANDING",
    basicSalary: "5000",
    work: { ...base, dateOfJoining: new Date("2027-11-01") },
  });
  assert.equal(r.eligible, false);
  assert.match(r.ineligibleReason as string, /Under 6 months/);
  assert.equal(r.amount, null, "no amount — distinct from an amount of zero");
});

test("a missing salary yields no amount, not a zero", () => {
  // §3.3 makes salary required, so a missing one is an import gap for HR to fix.
  const r = computeBonus({ band: "EXCELLENT", basicSalary: null, work: base });
  assert.equal(r.eligible, true);
  assert.equal(r.amount, null);
});

test("§11.4 money is exact — the float that would drift", () => {
  const r = computeBonus({
    band: "EXCELLENT",
    basicSalary: "1234.56",
    work: { ...base, unpaidLeaveDays: 5 },
  });
  // 1.5 × 1234.56 × (360/365)
  const expected = new Prisma.Decimal("1.5").times("1234.56").times(360).div(365).toFixed(2);
  assert.equal(r.amount, expected);
});

// --- §10.2 / §10.4's distribution --------------------------------------------------

test("§8.7's five bands, best to worst", () => {
  assert.deepEqual(BANDS, [
    "OUTSTANDING",
    "EXCELLENT",
    "TARGET",
    "ALMOST_ACHIEVED",
    "UNSATISFACTORY",
  ]);
});

test("an empty distribution still names every band", () => {
  // A band with nobody in it is a fact HR needs to see, not a row to omit.
  assert.deepEqual(Object.keys(emptyDistribution()).sort(), [...BANDS].sort());
});

test("§10.4 the gap is reported per band, target vs actual", () => {
  const actual = tally(["OUTSTANDING", "TARGET", "TARGET", "TARGET", "EXCELLENT"]);
  const gap = distributionGap({
    actual,
    targetPct: {
      OUTSTANDING: 10,
      EXCELLENT: 20,
      TARGET: 40,
      ALMOST_ACHIEVED: 20,
      UNSATISFACTORY: 10,
    },
    headcount: 5,
  });
  const target = gap.find((g) => g.band === "TARGET")!;
  assert.equal(target.actualCount, 3);
  assert.equal(target.actualPct, "60.00");
  assert.equal(target.targetPct, "40.00");
  // 3 actual vs 2 implied by the target → one person over.
  assert.equal(target.deltaCount, "1.00");
});

test("§10.4 the gap function suggests NOBODY — that judgment is HR's", () => {
  const gap = distributionGap({
    actual: tally(["OUTSTANDING"]),
    targetPct: emptyDistribution() as unknown as Record<(typeof BANDS)[number], number>,
    headcount: 1,
  });
  // The shape carries counts and percentages only: no employee ids, no
  // "move these people" list. §10.4 is explicit that calibration is guided and
  // "does not mathematically force people into bands".
  for (const row of gap) {
    assert.deepEqual(Object.keys(row).sort(), [
      "actualCount",
      "actualPct",
      "band",
      "deltaCount",
      "targetPct",
    ]);
  }
});

// --- §10.3's threshold ---------------------------------------------------------------

test("§10.3 the curve applies only at or above the threshold", () => {
  assert.equal(isCurveEligible(5, 5), true);
  assert.equal(isCurveEligible(4, 5), false);
  // "The threshold (5) is an editable setting."
  assert.equal(isCurveEligible(4, 3), true);
});

// --- §10.5 / §10.6's authority --------------------------------------------------------

test("§10.6 HRBP does NOT touch calibration", () => {
  // The one place the spec separates the two HR roles on an action.
  const refusal = adjustmentBlockedReason({
    actor: hrbp,
    fromBand: "TARGET",
    toBand: "EXCELLENT",
    reason: "strong year",
    published: false,
  });
  assert.equal(refusal?.status, 403);
  assert.match(refusal?.reason as string, /HRBP does not touch calibration/);
});

test("§10.6 an HR Super Admin may adjust", () => {
  assert.equal(
    adjustmentBlockedReason({
      actor: superAdmin,
      fromBand: "TARGET",
      toBand: "EXCELLENT",
      reason: "strong year",
      published: false,
    }),
    null,
  );
});

test("§10.5 the reason is mandatory, and whitespace is not a reason", () => {
  for (const reason of [null, "", "   "]) {
    const refusal = adjustmentBlockedReason({
      actor: superAdmin,
      fromBand: "TARGET",
      toBand: "EXCELLENT",
      reason,
      published: false,
    });
    assert.equal(refusal?.status, 409, `reason ${JSON.stringify(reason)} must be refused`);
    assert.match(refusal?.reason as string, /mandatory reason/);
  }
});

test("an adjustment that moves nothing is refused", () => {
  const refusal = adjustmentBlockedReason({
    actor: superAdmin,
    fromBand: "TARGET",
    toBand: "TARGET",
    reason: "no change",
    published: false,
  });
  assert.equal(refusal?.status, 409);
});

test("§13.2 adjusting a PUBLISHED cycle is refused — un-publish first", () => {
  const refusal = adjustmentBlockedReason({
    actor: superAdmin,
    fromBand: "TARGET",
    toBand: "EXCELLENT",
    reason: "corrected",
    published: true,
  });
  assert.equal(refusal?.status, 409);
  assert.match(refusal?.reason as string, /Un-publish before adjusting/);
});

// --- §10.7's gate ------------------------------------------------------------------------

test("§10.7 no calibration until ALL raw scores are in", () => {
  const reason = calibrationReadinessBlockedReason({
    participantCount: 40,
    scoredCount: 39,
    hasTarget: true,
  });
  assert.match(reason as string, /39 of 40/);
  assert.match(reason as string, /no calibration until all raw scores are in/i);
});

test("§10.7 a complete, targeted cycle is ready", () => {
  assert.equal(
    calibrationReadinessBlockedReason({ participantCount: 40, scoredCount: 40, hasTarget: true }),
    null,
  );
});

test("§10.2 a cycle with no target distribution is not ready", () => {
  assert.match(
    calibrationReadinessBlockedReason({
      participantCount: 40,
      scoredCount: 40,
      hasTarget: false,
    }) as string,
    /target distribution/,
  );
});

test("a cycle with no score run at all says so plainly", () => {
  assert.match(
    calibrationReadinessBlockedReason({
      participantCount: 40,
      scoredCount: 0,
      hasTarget: true,
    }) as string,
    /score run before calibration/,
  );
});

// --- §13.6 the one sum of the bonus --------------------------------------------

/**
 * The executive dashboard and the §13.5 bonus report each showed a bonus total,
 * computed two different ways: one folded `Prisma.Decimal` on the server, the
 * other re-summed `Number(row.bonus)` in the browser. This pins the single fold
 * they now share, and pins it against the float sum it replaced.
 */
test("§13.6 the bonus total is folded in Decimal, not floating point", async () => {
  const { bonusTotals } = await import("../../lib/pms/bonus-report");

  // Three amounts whose float sum is NOT their decimal sum: 0.1 + 0.2 + 0.3
  // is 0.6000000000000001 in binary floating point.
  const rows = [
    { bonus: "0.100", eligible: true },
    { bonus: "0.200", eligible: true },
    { bonus: "0.300", eligible: true },
  ];

  const totals = bonusTotals(rows);
  assert.equal(totals.total, "0.600");

  // The reason the fold exists, stated as an assertion rather than a comment:
  // the float sum these rows used to produce is not the number they add up to.
  const floatSum = rows.reduce((sum, row) => sum + Number(row.bonus ?? 0), 0);
  assert.notEqual(String(floatSum), "0.6", "0.1 + 0.2 + 0.3 is inexact in binary floating point");

  assert.equal(totals.eligible, 3);
  assert.equal(totals.ineligible, 0);
  assert.equal(totals.employees, 3);
});

test("§11.5 an ineligible row contributes no money but is still counted", async () => {
  const { bonusTotals } = await import("../../lib/pms/bonus-report");

  const rows = [
    { bonus: "1200.500", eligible: true },
    // §11.4 — under six months' effective service, so no bonus at all.
    { bonus: null, eligible: false },
  ];

  const totals = bonusTotals(rows);
  assert.equal(totals.total, "1200.500");
  assert.equal(totals.eligible, 1);
  assert.equal(totals.ineligible, 1);
  assert.equal(totals.employees, 2, "the headcount counts everyone, paid or not");
});

// --- §10.2 / §10.3 the target distribution the editor writes --------------------

/**
 * The rule the new §10.2 editor mirrors on screen. It is checked in both places
 * deliberately — the screen so an operator learns it by reading, the schema
 * because the screen is guidance and never the control.
 */
test("§10.2 the five band percentages must total exactly 100", async () => {
  const { setTargetSchema } = await import("../../lib/validations/calibration");
  const base = { cycleId: "c1", minDepartmentSize: 5 };

  const ok = setTargetSchema.safeParse({
    ...base,
    outstandingPct: 10,
    excellentPct: 20,
    targetPct: 40,
    almostAchievedPct: 20,
    unsatisfactoryPct: 10,
  });
  assert.equal(ok.success, true);

  for (const outstanding of [9, 11]) {
    const bad = setTargetSchema.safeParse({
      ...base,
      outstandingPct: outstanding,
      excellentPct: 20,
      targetPct: 40,
      almostAchievedPct: 20,
      unsatisfactoryPct: 10,
    });
    assert.equal(bad.success, false, `${outstanding + 90}% must be refused`);
  }
});

test("§10.2 fractional percentages that total 100 are accepted", async () => {
  const { setTargetSchema } = await import("../../lib/validations/calibration");
  // The editor compares at 2dp, so the schema has to agree at 2dp: a
  // distribution of thirds is a legitimate thing for HR to key in.
  const r = setTargetSchema.safeParse({
    cycleId: "c1",
    minDepartmentSize: 5,
    outstandingPct: 10.5,
    excellentPct: 19.5,
    targetPct: 40,
    almostAchievedPct: 20,
    unsatisfactoryPct: 10,
  });
  assert.equal(r.success, true);
});

test("§10.3 the curve threshold is editable but never below 2", async () => {
  const { setTargetSchema } = await import("../../lib/validations/calibration");
  const at = (minDepartmentSize: number) =>
    setTargetSchema.safeParse({
      cycleId: "c1",
      minDepartmentSize,
      outstandingPct: 10,
      excellentPct: 20,
      targetPct: 40,
      almostAchievedPct: 20,
      unsatisfactoryPct: 10,
    }).success;

  assert.equal(at(2), true);
  assert.equal(at(25), true, "§10.3 says the threshold is HR's to set");
  // A department of one has no distribution to shape at all.
  assert.equal(at(1), false);
});
