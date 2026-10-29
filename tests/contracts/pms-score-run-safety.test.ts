import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { scoreEmployee, scoreSplitEmployee, scoreRangeProblem } from "../../lib/pms/score-run";
import { Prisma } from "../../generated/prisma/client";

/**
 * QA2 N-01 — the score run crashed with HTTP 500 on `employee_scores_ranges_check`
 * and left half-written runs behind. Two halves to the fix, both pinned here:
 *   1. a participant whose inputs land outside §8.1's 1–5 scale is SKIPPED with
 *      a reason a person can act on, never written (so the DB check never fires);
 *   2. the run is one transaction, so a failure cannot leave a partial run.
 */

const d = (v: string) => new Prisma.Decimal(v);
const kpis = [{ description: "Delivery", level: 3, weightage: "100" }];
const signed = ["EMPLOYEE", "MANAGER"] as const;

test("N-01 a split year covering a few days of service is skipped with a readable reason, not written", () => {
  // The demo fixture's trigger: a pre-joiner whose §12.3 periods were clamped to
  // ~30 days of service, so the day-weighted components fell to ~0.25 — below
  // the 1–5 scale the database enforces.
  const out = scoreSplitEmployee({
    employeeId: "e1",
    roleTrack: "INDIVIDUAL",
    signedParties: signed,
    threeSixty: d("4"),
    periods: [
      {
        orderIndex: 0,
        startsOn: new Date("2026-12-01"),
        endsOn: new Date("2026-12-15"),
        corporate: d("3"),
        departmental: null,
        kpis,
      },
      {
        orderIndex: 1,
        startsOn: new Date("2026-12-16"),
        endsOn: new Date("2026-12-31"),
        corporate: d("3"),
        departmental: null,
        kpis,
      },
    ],
  });
  assert.equal(out.scored, false);
  if (out.scored) return;
  assert.match(out.reason, /1–5 scale/);
  assert.match(out.reason, /31 days/);
});

test("N-01 a split year with NO days of service at all is skipped, not divided into a zero", () => {
  const out = scoreSplitEmployee({
    employeeId: "e2",
    roleTrack: "INDIVIDUAL",
    signedParties: signed,
    threeSixty: d("4"),
    periods: [0, 1].map((orderIndex) => ({
      orderIndex,
      // inverted windows: clampToService's way of saying "not employed then"
      startsOn: new Date("2027-02-01"),
      endsOn: new Date("2026-12-31"),
      corporate: d("3"),
      departmental: null,
      kpis,
    })),
  });
  assert.equal(out.scored, false);
  if (out.scored) return;
  assert.match(out.reason, /no days of service/i);
});

test("N-01 an out-of-range keyed input is skipped per person (one bad record never blocks everyone)", () => {
  const out = scoreEmployee({
    employeeId: "e3",
    roleTrack: "INDIVIDUAL",
    corporate: d("7"),
    departmental: null,
    kpis,
    signedParties: signed,
    threeSixty: d("4"),
  });
  assert.equal(out.scored, false);
  if (out.scored) return;
  assert.match(out.reason, /Corporate score is 7/);
});

test("N-01 the range check mirrors employee_scores_ranges_check exactly", () => {
  const ok = {
    corporate: d("1"),
    departmental: null,
    individual: d("5"),
    threeSixty: d("0"),
    raw: d("1"),
  };
  assert.equal(scoreRangeProblem(ok), null);
  assert.match(scoreRangeProblem({ ...ok, raw: d("0.99") }) ?? "", /final score/);
  assert.match(scoreRangeProblem({ ...ok, threeSixty: d("5.01") }) ?? "", /360/);
  assert.match(scoreRangeProblem({ ...ok, departmental: d("0.5") }) ?? "", /Departmental/);
});

test("N-01 the score run is one transaction and repairs half-written runs left by earlier crashes", () => {
  const src = readFileSync("app/api/scores/route.ts", "utf8");
  assert.match(src, /auditedTransaction\(/, "the run must be written atomically");
  assert.match(src, /finishedAt: null/, "unfinished runs are repaired on the next run");
});

test("N-01 every 'latest run' reader ignores an unfinished run", () => {
  for (const f of [
    "lib/pms/status-query.ts",
    "lib/pms/bonus-report.ts",
    "app/api/publish/route.ts",
    "app/api/scorecard/route.ts",
    "app/api/calibration/route.ts",
    "app/api/reports/executive/route.ts",
    "app/api/reports/results-distribution/route.ts",
    "app/api/reports/master-results/route.ts",
  ]) {
    const src = readFileSync(f, "utf8");
    const reads = src.match(/scoreRun\.findMany\(\{\s*where: [^}]*\}/g) ?? [];
    assert.ok(reads.length > 0, `${f} reads score runs`);
    for (const r of reads) assert.match(r, /completedRunWhere|finishedAt/, `${f}: ${r}`);
  }
});
