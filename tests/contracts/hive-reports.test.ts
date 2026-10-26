import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";

// Blueprint US-T7: HIVE's reporting screen. What is worth pinning:
//   1. it is COUNTS ONLY — no employee, address or question in the payload;
//   2. the range is bounded at the boundary (a year), and days are Muscat days;
//   3. the volume series is complete (zero-filled) and switches to weeks past
//      ~three months, with weeks starting Monday like Postgres's date_trunc.
// The SQL itself (date_trunc / percentile_cont) was checked against Postgres;
// here the database is a double.

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

type Reports = typeof import("../../lib/hive/services/reports.ts");
type Range = typeof import("../../lib/validations/hive/reports.ts");
let reports: Reports;
let range: Range;

before(async () => {
  range = (await import(import.meta.resolve("../../lib/validations/hive/reports.ts"))) as Range;
  if (!canMock) return;
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        escalation: {
          count: async () => 3,
          groupBy: async ({ by }: { by: string[] }) =>
            by[0] === "hrPairId"
              ? [
                  { hrPairId: "p1", _count: { _all: 1 } },
                  { hrPairId: "p2", _count: { _all: 2 } },
                ]
              : by[0] === "status"
                ? [{ status: "OPEN", _count: { _all: 3 } }]
                : [{ source: "SIRAAJ", _count: { _all: 3 } }],
        },
        hrTagPair: {
          findMany: async () => [
            { id: "p1", name: "Siham & Alaa" },
            { id: "p2", name: "Rahma & Mohammed" },
          ],
        },
        // Told apart by their SQL: the median or the volume series.
        $queryRaw: async (sql: TemplateStringsArray) =>
          sql.join("").includes("percentile_cont")
            ? [{ hours: 12.34 }]
            : [{ bucket: "2026-10-02", count: 3 }],
      },
    },
  });
  reports = (await import(import.meta.resolve("../../lib/hive/services/reports.ts"))) as Reports;
});

describe("US-T7 — the range", () => {
  test("defaults to the last 30 days, today included", () => {
    const r = range.reportRangeSchema.parse({});
    assert.equal(r.days, 30);
  });

  test("days are Muscat days, and 'to' covers its whole day", () => {
    const r = range.reportRangeSchema.parse({ from: "2026-10-01", to: "2026-10-03" });
    assert.equal(r.gte.toISOString(), "2026-09-30T20:00:00.000Z");
    assert.equal(r.lt.toISOString(), "2026-10-03T20:00:00.000Z");
    assert.equal(r.days, 3);
  });

  test("an end before the start, or a range over a year, is refused", () => {
    assert.equal(
      range.reportRangeSchema.safeParse({ from: "2026-10-05", to: "2026-10-01" }).success,
      false,
    );
    assert.equal(
      range.reportRangeSchema.safeParse({ from: "2025-01-01", to: "2026-10-01" }).success,
      false,
    );
    assert.equal(
      range.reportRangeSchema.safeParse({ from: "2025-10-02", to: "2026-10-01" }).success,
      true,
    );
  });

  test("a date that is not on the calendar is refused", () => {
    assert.equal(range.reportRangeSchema.safeParse({ from: "2026-02-30" }).success, false);
    assert.equal(range.reportRangeSchema.safeParse({ from: "01/10/2026" }).success, false);
  });
});

describe("US-T7 — buckets", { skip: !canMock }, () => {
  test("daily buckets cover every day of the range", () => {
    assert.deepEqual(reports.bucketStarts("2026-10-01", "2026-10-03", "day"), [
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
  });

  test("weekly buckets start on Monday, as Postgres's date_trunc('week') does", () => {
    // 2026-10-01 is a Thursday; its week began Monday 2026-09-28.
    assert.deepEqual(reports.bucketStarts("2026-10-01", "2026-10-13", "week"), [
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
    ]);
  });
});

describe("US-T7 — the report", { skip: !canMock }, () => {
  test("is counts only: no employee, address or question anywhere in it", async () => {
    const report = await reports.getTicketReport(
      range.reportRangeSchema.parse({ from: "2026-10-01", to: "2026-10-03" }),
    );
    assert.doesNotMatch(JSON.stringify(report), /employee|email|question/i);
  });

  test("the volume series is zero-filled, and short ranges are daily", async () => {
    const report = await reports.getTicketReport(
      range.reportRangeSchema.parse({ from: "2026-10-01", to: "2026-10-03" }),
    );
    assert.equal(report.range.bucket, "day");
    assert.deepEqual(
      report.volume.map((v) => v.count),
      [0, 3, 0],
    );
  });

  test("past about three months the series is weekly", async () => {
    const report = await reports.getTicketReport(
      range.reportRangeSchema.parse({ from: "2026-01-01", to: "2026-10-01" }),
    );
    assert.equal(report.range.bucket, "week");
  });

  test("pairs are named in one lookup and sorted busiest first; the median is rounded", async () => {
    const report = await reports.getTicketReport(
      range.reportRangeSchema.parse({ from: "2026-10-01", to: "2026-10-03" }),
    );
    assert.deepEqual(
      report.byPair.map((p) => p.name),
      ["Rahma & Mohammed", "Siham & Alaa"],
    );
    assert.equal(report.tiles.medianHoursToAnswer, 12.3);
  });
});
