import test from "node:test";
import assert from "node:assert/strict";

import {
  attritionRate,
  BELOW_THRESHOLD,
  employedOn,
  lowerMedian,
  monthsBetween,
  settlementBucket,
  suppressSmallCells,
  tenureBand,
  topReason,
} from "../../lib/jml/reports/leave/rules";
import { parseCsv, validateImport } from "../../lib/jml/leave/import-rules";

/** JML S6c — leaver reports R1–R8 (Module 16) and the historical import (§26.2). */

const d = (s: string) => new Date(`${s}T00:00:00Z`);

test("BR-OFF-024: cells under 4 merge into one row; its count shows only when ≥ 4", () => {
  const cells = [
    { m: "A", exits: 7 },
    { m: "B", exits: 2 },
    { m: "C", exits: 1 },
  ];
  const r = suppressSmallCells(cells, "exits", "m");
  assert.equal(r.suppressed, 2);
  assert.deepEqual(r.cells.at(-1), { m: BELOW_THRESHOLD, exits: null, cellsMerged: 2 });
  const r2 = suppressSmallCells([...cells, { m: "D", exits: 3 }], "exits", "m");
  assert.equal(r2.cells.at(-1)!.exits, 6);
  assert.equal(suppressSmallCells([{ m: "A", exits: 4 }], "exits", "m").suppressed, 0);
});

test("F17: tenure bands on UTC calendar months, inclusive upper bounds", () => {
  assert.equal(monthsBetween(d("2025-01-31"), d("2025-07-30")), 5);
  assert.equal(tenureBand(d("2025-01-01"), d("2025-07-01")), "0-6");
  assert.equal(tenureBand(d("2025-01-01"), d("2025-08-01")), "7-12");
  assert.equal(tenureBand(d("2020-01-01"), d("2025-01-01")), "25-60");
  assert.equal(tenureBand(d("2019-01-01"), d("2025-02-01")), "60+");
  assert.equal(tenureBand(null, d("2025-01-01")), null);
});

test("§12.5.2 attrition: average headcount, annualised under a year, unavailable without a denominator", () => {
  assert.deepEqual(attritionRate(10, 100, 100, 365), {
    averageHeadcount: 100,
    rate: 10,
    annualised: 10,
  });
  assert.deepEqual(attritionRate(5, 90, 110, 73), {
    averageHeadcount: 100,
    rate: 5,
    annualised: 25,
  });
  assert.equal(attritionRate(3, 0, 0, 30).rate, null);
  assert.equal(
    employedOn(
      { dateOfJoining: d("2024-01-01"), lastWorkingDay: d("2025-01-31") },
      d("2025-01-31"),
    ),
    true,
  );
  assert.equal(
    employedOn(
      { dateOfJoining: d("2024-01-01"), lastWorkingDay: d("2025-01-31") },
      d("2025-02-01"),
    ),
    false,
  );
  assert.equal(employedOn({ dateOfJoining: null, lastWorkingDay: null }, d("2025-02-01")), false);
});

test("R7 buckets, lower median, R4 top reason", () => {
  assert.equal(
    settlementBucket({
      paymentConfirmedAt: d("2025-01-01"),
      approvedAt: d("2025-01-01"),
      provisional: false,
    }),
    "PAID",
  );
  assert.equal(
    settlementBucket({ paymentConfirmedAt: null, approvedAt: d("2025-01-01"), provisional: false }),
    "APPROVED_AWAITING_PAYMENT",
  );
  assert.equal(
    settlementBucket({ paymentConfirmedAt: null, approvedAt: null, provisional: true }),
    "PROVISIONAL_UNVERIFIED_INPUTS",
  );
  assert.equal(
    settlementBucket({ paymentConfirmedAt: null, approvedAt: null, provisional: false }),
    "AWAITING_APPROVAL",
  );
  assert.equal(lowerMedian([5, 1, 3, 9]), 3);
  assert.equal(lowerMedian([]), null);
  assert.deepEqual(topReason(["VDS-03", "VDS-03", "VAA-01", null]), {
    code: "VDS-03",
    concentration: 50,
  });
});

const HEADER =
  "caseRef,employeeExternalId,exitType,nationality,noticeStartDate,lastDayOfService,lastPhysicalWorkingDay,primaryL1,primaryL2Code";

test("§26.2 CSV: BOM, quotes, doubled quotes and embedded commas", () => {
  assert.deepEqual(parseCsv('﻿a,b\n"x, y","say ""hi"""\r\n\n'), [
    ["a", "b"],
    ["x, y", 'say "hi"'],
  ]);
});

test("§26.2 import: missing column refuses the file; rows reported per line; duplicates name both lines; future LDS refused", () => {
  const today = d("2026-10-27");
  assert.match(
    validateImport("caseRef,exitType\nX,RESIGNATION", today).fatal!,
    /Missing required column/,
  );
  const csv = [
    HEADER,
    "EXIT-2024-0001,1001,RESIGNATION,OMANI,2024-01-01,2024-03-01,,VOLUNTARY_PERSONAL,VPR-01",
    "EXIT-2024-0002,1002,QUIT,OMANI,2024-01-01,2024-03-01,,,",
    "EXIT-2024-0001,1003,RESIGNATION,OMANI,2024-01-01,2024-03-01,,,",
    "EXIT-2026-0009,1004,RESIGNATION,EXPATRIATE,2026-10-01,2026-12-01,,,",
    "EXIT-2024-0003,1005,TERMINATION,OMANI,2024-02-01,2024-03-01,2024-03-05,,",
  ].join("\n");
  const r = validateImport(csv, today);
  assert.equal(r.fatal, null);
  assert.deepEqual(
    r.rows.map((x) => x.caseRef),
    ["EXIT-2024-0001"],
  );
  assert.equal(r.rows[0]!.lastPhysicalWorkingDay.toISOString().slice(0, 10), "2024-03-01");
  assert.equal(r.rows[0]!.primaryL2Code, "VPR-01");
  assert.deepEqual(
    r.problems.map((p) => p.line),
    [3, 4, 5, 6],
  );
  assert.match(r.problems[1]!.message, /line 2/);
  assert.match(r.problems[2]!.message, /RE-KEYED/);
  assert.match(r.problems[3]!.message, /before lastPhysicalWorkingDay/);
});
