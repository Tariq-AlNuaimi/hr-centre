import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { caseRungs, levelOf, unitIdOf } from "../../lib/core/hr-coverage/rules";
import { hrCoverageSchema } from "../../lib/validations/core/hr-coverage";

// ADR-102: one "who is my HR" model. The pure rules both modules read, the save
// schema, and the wiring that keeps each module's outcomes unchanged.

test("a row's level is the most specific unit it names; company-wide is the company", () => {
  const base = { entityId: "co", directorateId: null, departmentId: null, teamId: null };
  assert.equal(levelOf({ ...base, companyWide: true }), "COMPANY");
  assert.equal(levelOf(base), "COMPANY");
  assert.equal(levelOf({ ...base, directorateId: "d" }), "DIRECTORATE");
  // Same order as the ticket selector reads a row with both links: department first.
  assert.equal(levelOf({ ...base, directorateId: "d", departmentId: "p" }), "DEPARTMENT");
  assert.equal(levelOf({ ...base, teamId: "t" }), "TEAM");
  assert.equal(levelOf({ ...base, entityId: null }), null, "words only");
  assert.equal(unitIdOf({ ...base, level: "DEPARTMENT", departmentId: "p" }), "p");
  assert.equal(unitIdOf({ ...base, level: "COMPANY" }), "co");
});

test("JML's ladder: department, then directorate, then company — only the rungs a placement has", () => {
  assert.deepEqual(
    caseRungs({ entityId: "co", directorateId: "d", departmentId: "p" }).map((r) => r.level),
    ["DEPARTMENT", "DIRECTORATE", "COMPANY"],
  );
  assert.deepEqual(
    caseRungs({ entityId: "co", directorateId: null, departmentId: null }).map((r) => r.where),
    [{ level: "COMPANY", entityId: "co" }],
  );
});

test("the save schema: one unit, a half at least, both seats or neither, words for a pair", () => {
  const ok = { entityId: "co", pairId: "p", label: "Tech" };
  assert.equal(hrCoverageSchema.safeParse(ok).success, true);
  assert.equal(hrCoverageSchema.safeParse({ entityId: "co" }).success, false, "no half");
  assert.equal(hrCoverageSchema.safeParse({ ...ok, label: "" }).success, false, "pair needs words");
  assert.equal(
    hrCoverageSchema.safeParse({ ...ok, ownerUserId: "a" }).success,
    false,
    "both seats or neither",
  );
  assert.equal(
    hrCoverageSchema.safeParse({ ...ok, directorateId: "d", departmentId: "x" }).success,
    false,
    "one unit",
  );
  assert.equal(
    hrCoverageSchema.safeParse({ ...ok, companyWide: true, departmentId: "x" }).success,
    false,
    "whole company names no unit",
  );
});

test("both modules read the same table, each with its own rules", () => {
  const assignment = readFileSync("lib/jml/engine/assignment.ts", "utf8");
  assert.match(assignment, /resolveCaseOwner\(placement, caseType, client\)/);
  assert.doesNotMatch(assignment, /jmlHrAssignmentRule/);
  const source = readFileSync("lib/hive/hrtag-source.ts", "utf8");
  assert.match(source, /where: \{ deletedAt: null, active: true \}/);
  const store = readFileSync("lib/core/hr-coverage/store.ts", "utf8");
  // Only active rows with both seats live own a case.
  assert.match(store, /active: true, deletedAt: null, \.\.\.LIVE_SEATS/);
  // The legacy table is gone from every reader.
  for (const f of ["lib/hive/services/reference.ts", "prisma/seed-hive.ts"])
    assert.doesNotMatch(readFileSync(f, "utf8"), /hrTagCoverage/);
});

test("the screen's routes: auth wrapper, rate limit outside, zod, each half's permission", () => {
  for (const f of ["app/api/hr-coverage/route.ts", "app/api/hr-coverage/[id]/route.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /withRateLimit\(\s*withAuth\(/);
    assert.match(src, /if \(!editor\.tickets && !editor\.jml\) return forbidden\(\)/);
  }
  const admin = readFileSync("lib/core/hr-coverage/admin.ts", "utf8");
  assert.match(admin, /hasGroup\(grants, "tickets\.configure"\)/);
  assert.match(admin, /hasGroup\(grants, "jml\.configure"\)/);
});
