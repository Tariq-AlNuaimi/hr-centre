import test from "node:test";
import assert from "node:assert/strict";

import {
  computeGratuity,
  computeLeave,
  serviceMonths,
  settlementLineProblems,
  settlementTotals,
  visaCostRecoveryApplies,
  GratuityUnavailableError,
} from "../../lib/jml/leave/gratuity";
import {
  canApproveSettlement,
  canCloseSettlement,
  canTransmitSettlement,
} from "../../lib/jml/leave/settlement-rules";
import {
  checkAssessment,
  checkInterviewCapture,
  reasonsChanged,
  type TaxonomyCode,
} from "../../lib/jml/leave/interview-rules";
import { EXIT_REASON_TAXONOMY, STATUTORY_SEED } from "../../prisma/seed-jml-data";
import type { StatutoryRow } from "../../lib/statutory/parameters";

/** JML S6 — settlement and gratuity (§16.1, T11–T17) and the exit interview (§12.3–12.4). */

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const ROWS: StatutoryRow[] = STATUTORY_SEED.map((r) => ({ ...r, verified: false }));
const VERIFIED: StatutoryRow[] = ROWS.map((r) => ({ ...r, verified: true }));

test("T11: service wholly before the split — hire 2017-01-01, LDS 2021-12-31, basic 600", () => {
  const g = computeGratuity(
    {
      hireDate: d("2017-01-01"),
      lastDayOfService: d("2021-12-31"),
      basicMonthly: 600,
      exitType: "RESIGNATION",
    },
    ROWS,
  );
  assert.equal(g.preSplitAmount, 2101.644);
  assert.equal(g.postSplitAmount, 0);
  assert.equal(g.total, 2101.644);
  assert.equal(g.provisional, true);
});

test("T12: service wholly after the split — hire 2023-08-01, LDS 2026-07-31, basic 900", () => {
  const g = computeGratuity(
    {
      hireDate: d("2023-08-01"),
      lastDayOfService: d("2026-07-31"),
      basicMonthly: 900,
      exitType: "RESIGNATION",
    },
    ROWS,
  );
  assert.equal(g.preSplitAmount, 0);
  assert.equal(g.postSplitAmount, 2702.466);
});

test("T13: spanning the split — 729 days before, 732 after, basic 800", () => {
  const g = computeGratuity(
    {
      hireDate: d("2021-08-01"),
      lastDayOfService: d("2025-07-31"),
      basicMonthly: 800,
      exitType: "RESIGNATION",
    },
    ROWS,
  );
  assert.equal(g.preSplitDays, 729);
  assert.equal(g.postSplitDays, 732);
  assert.equal(g.preSplitAmount, 798.904);
  assert.equal(g.postSplitAmount, 1604.384);
  assert.equal(g.total, 2403.288);
});

test("verified parameters make it final; refusals: LDS before hire, zero basic, O2 unconfigured", () => {
  const g = computeGratuity(
    {
      hireDate: d("2023-08-01"),
      lastDayOfService: d("2026-07-31"),
      basicMonthly: 900,
      exitType: "RESIGNATION",
    },
    VERIFIED,
  );
  assert.equal(g.provisional, false);
  const base = {
    hireDate: d("2020-01-01"),
    lastDayOfService: d("2024-01-01"),
    basicMonthly: 500,
    exitType: "RESIGNATION",
  };
  assert.throws(
    () => computeGratuity({ ...base, lastDayOfService: d("2019-01-01") }, ROWS),
    GratuityUnavailableError,
  );
  assert.throws(
    () => computeGratuity({ ...base, basicMonthly: 0 }, ROWS),
    GratuityUnavailableError,
  );
  assert.throws(() => computeGratuity({ ...base, exitType: "SUMMARY_DISMISSAL" }, ROWS), /O2/);
});

test("F14: the O2 factor is effective-dated and an unverified factor is provisional", () => {
  const factor: StatutoryRow = {
    key: "gratuity.summaryDismissal.entitlementFactor",
    value: "0.5",
    effectiveFrom: d("1970-01-01"),
    effectiveTo: null,
    verified: false,
  };
  const g = computeGratuity(
    {
      hireDate: d("2023-08-01"),
      lastDayOfService: d("2026-07-31"),
      basicMonthly: 900,
      exitType: "SUMMARY_DISMISSAL",
    },
    [...VERIFIED, factor],
  );
  assert.equal(g.postSplitAmount, 1351.233);
  assert.deepEqual(g.unverifiedParameters, ["gratuity.summaryDismissal.entitlementFactor"]);
  const later = { ...factor, effectiveFrom: d("2027-01-01") };
  assert.throws(
    () =>
      computeGratuity(
        {
          hireDate: d("2023-08-01"),
          lastDayOfService: d("2026-07-31"),
          basicMonthly: 900,
          exitType: "SUMMARY_DISMISSAL",
        },
        [...VERIFIED, later],
      ),
    /O2/,
  );
});

test("AC-10.4 / T16: leave encashment, negative balance is a deduction", () => {
  assert.deepEqual(
    computeLeave({ balanceDaysAtLastDayOfService: 10, basicMonthly: 900 }, ROWS, d("2026-01-01")),
    { kind: "ENCASHMENT", days: 10, amount: 300 },
  );
  assert.deepEqual(
    computeLeave({ balanceDaysAtLastDayOfService: -3, basicMonthly: 900 }, ROWS, d("2026-01-01")),
    { kind: "DEDUCTION", days: 3, amount: 90, requiresReference: true },
  );
  assert.deepEqual(
    computeLeave({ balanceDaysAtLastDayOfService: 0, basicMonthly: 900 }, ROWS, d("2026-01-01")),
    { kind: "NONE" },
  );
});

test("T14 / T15: visa cost recovery under 24 months for expatriates", () => {
  assert.equal(
    visaCostRecoveryApplies({ nationality: "EXPATRIATE", serviceMonths: 18 }, ROWS, d("2026-01-01"))
      .applies,
    true,
  );
  assert.equal(
    visaCostRecoveryApplies({ nationality: "EXPATRIATE", serviceMonths: 30 }, ROWS, d("2026-01-01"))
      .applies,
    false,
  );
  assert.equal(
    visaCostRecoveryApplies({ nationality: "OMANI", serviceMonths: 6 }, ROWS, d("2026-01-01"))
      .applies,
    false,
  );
  assert.equal(serviceMonths(d("2024-07-15"), d("2026-01-14")), 17);
  assert.equal(serviceMonths(d("2024-07-15"), d("2026-01-15")), 18);
});

test("C4: a deduction line needs type, amount, reason, reference and authoriser", () => {
  const ok = {
    lineType: "DEDUCTION" as const,
    deductionType: "NOTICE_SHORTFALL",
    lineAmount: 50,
    reasonCode: "NS",
    documentaryReference: "memo",
    authorisedById: "u1",
  };
  assert.deepEqual(settlementLineProblems(ok), []);
  assert.equal(
    settlementLineProblems({
      ...ok,
      deductionType: "BONUS",
      lineAmount: 0,
      reasonCode: "",
      documentaryReference: null,
      authorisedById: null,
    }).length,
    5,
  );
  assert.match(
    settlementLineProblems({ ...ok, documentaryReference: "" }).join(),
    /approval record reference/,
  );
  assert.deepEqual(
    settlementTotals({
      gratuityTotal: 1000.1,
      leaveEncashment: 300,
      outstandingSalary: 99.95,
      additions: [10],
      deductions: [50.05],
    }),
    { gross: 1400.05, net: 1360 },
  );
});

test("AC-10.6–10.8: approval needs both signatures, verified values, references, settled assets; closure needs payment", () => {
  const assets = [
    {
      identifier: "LT-1",
      description: null,
      returnedDate: null,
      writtenOff: false,
      deductionApplicable: false,
    },
  ];
  assert.equal(canTransmitSettlement(assets).allowed, false);
  const base = {
    calculated: true,
    recalculationRequired: false,
    provisional: false,
    unverifiedKeys: [],
    unreferencedDeductions: 0,
    assets: [],
    signatures: { granted: true, missingHolders: [] },
    alreadyApproved: false,
  };
  assert.equal(canApproveSettlement(base).allowed, true);
  const refused = canApproveSettlement({
    ...base,
    provisional: true,
    unverifiedKeys: ["gratuity.daysInMonth"],
    assets,
    signatures: { granted: false, missingHolders: ["Operations Director"] },
  });
  assert.equal(refused.allowed, false);
  assert.equal(!refused.allowed && refused.reasons.length, 3);
  assert.equal(
    canCloseSettlement({
      approvedAt: d("2026-01-01"),
      paymentConfirmedAt: d("2026-01-02"),
      paymentReference: "TRX",
    }).allowed,
    true,
  );
  assert.equal(
    canCloseSettlement({
      approvedAt: d("2026-01-01"),
      paymentConfirmedAt: null,
      paymentReference: null,
    }).allowed,
    false,
  );
});

const TAXONOMY: TaxonomyCode[] = Object.entries(EXIT_REASON_TAXONOMY).flatMap(([level1, codes]) =>
  codes.map((c) => ({ code: c.code, label: c.label, level1, active: true })),
);

test("F9: interview codes come from the configured taxonomy — parent, active, secondary ≠ primary", () => {
  assert.equal(TAXONOMY.length, 35);
  const capture = {
    conducted: "CONDUCTED" as const,
    primaryL1: "VOLUNTARY_ATTRACTED_AWAY",
    primaryL2Code: "VAA-01",
    secondaryL2Code: "VAA-03",
    retentionAttempted: true,
    counterOfferMade: false,
    recommendScore: 4,
    returnScore: 3,
  };
  assert.deepEqual(
    checkInterviewCapture(capture, { exitType: "RESIGNATION", taxonomy: TAXONOMY }),
    [],
  );
  const added = [
    ...TAXONOMY,
    { code: "VAA-07", label: "Remote work", level1: "VOLUNTARY_ATTRACTED_AWAY", active: true },
  ];
  assert.deepEqual(
    checkInterviewCapture(
      { ...capture, primaryL2Code: "VAA-07" },
      { exitType: "RESIGNATION", taxonomy: added },
    ),
    [],
  );
  const inactive = TAXONOMY.map((c) => (c.code === "VAA-01" ? { ...c, active: false } : c));
  assert.match(
    checkInterviewCapture(capture, { exitType: "RESIGNATION", taxonomy: inactive })[0]!.message,
    /no longer in use/,
  );
  const wrongParent = checkInterviewCapture(
    { ...capture, primaryL2Code: "VDS-01", secondaryL2Code: null },
    { exitType: "RESIGNATION", taxonomy: TAXONOMY },
  );
  assert.match(wrongParent[0]!.message, /belongs to VOLUNTARY_DISSATISFACTION/);
  const fields = checkInterviewCapture(
    { ...capture, secondaryL2Code: "VAA-01", retentionAttempted: null, recommendScore: 6 },
    { exitType: "RESIGNATION", taxonomy: TAXONOMY },
  ).map((b) => b.field);
  assert.deepEqual(fields, ["secondaryL2Code", "recommendScore", "retentionAttempted"]);
  assert.deepEqual(
    checkInterviewCapture(
      { ...capture, retentionAttempted: null, counterOfferMade: null },
      { exitType: "TERMINATION", taxonomy: TAXONOMY },
    ),
    [],
  );
});

test("AC-9.2 assessment, and changing the reasons clears it", () => {
  assert.deepEqual(
    checkAssessment({
      regrettable: "REGRETTABLE",
      preventable: "PREVENTABLE",
      preventionFactor: "COMPENSATION",
    }),
    [],
  );
  assert.deepEqual(
    checkAssessment({
      regrettable: "REGRETTABLE",
      preventable: "PREVENTABLE",
      preventionFactor: null,
    }).map((b) => b.field),
    ["preventionFactor"],
  );
  assert.deepEqual(
    checkAssessment({ regrettable: null, preventable: "UNCLEAR", preventionFactor: "OTHER" }).map(
      (b) => b.field,
    ),
    ["regrettable", "preventionFactor"],
  );
  const before = { primaryL1: "CONTRACT", primaryL2Code: "CTR-01", secondaryL2Code: null };
  assert.equal(reasonsChanged(before, { ...before }), false);
  assert.equal(reasonsChanged(before, { ...before, primaryL2Code: "CTR-02" }), true);
  assert.equal(reasonsChanged(null, before), false);
});
