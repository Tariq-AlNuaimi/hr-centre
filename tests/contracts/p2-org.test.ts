import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { personContext } from "../../lib/pms/org-chart";
import { scheduleOrgChangeSchema } from "../../lib/validations/org";

/** P2 (UX R19) — visual org chart and effective-dated reorganisation (docs/blueprints/p2-org.md). */

const people = [
  { id: "ceo", name: "Ceo", managerId: null, departmentName: null },
  { id: "m", name: "Maryam", managerId: "ceo", departmentName: "HR" },
  { id: "z", name: "Zaid", managerId: "m", departmentName: "HR" },
  { id: "a", name: "Amal", managerId: "m", departmentName: "HR" },
];

test("AC-1.3 centre on a person: manager above, reports below, by name", () => {
  const ctx = personContext(people, "m");
  assert.equal(ctx?.manager?.id, "ceo");
  assert.deepEqual(
    ctx?.reports.map((r) => r.name),
    ["Amal", "Zaid"],
  );
  assert.equal(personContext(people, "ceo")?.manager, null);
  assert.equal(personContext(people, "nobody"), null);
});

test("AC-1.3 a manager outside the visible set is absent, never fetched", () => {
  const ctx = personContext(
    [{ id: "z", name: "Zaid", managerId: "hidden", departmentName: null }],
    "z",
  );
  assert.equal(ctx?.manager, null);
});

test("AC-2.1 a change must rename or move; directorates never move; teams need a department", () => {
  const base = { unitId: "u1", effectiveDate: "2027-01-01" };
  assert.equal(
    scheduleOrgChangeSchema.safeParse({ ...base, unitKind: "DEPARTMENT" }).success,
    false,
  );
  assert.equal(
    scheduleOrgChangeSchema.safeParse({ ...base, unitKind: "DEPARTMENT", newParentId: null })
      .success,
    true,
    "a department may leave its directorate",
  );
  assert.equal(
    scheduleOrgChangeSchema.safeParse({ ...base, unitKind: "DIRECTORATE", newParentId: "x" })
      .success,
    false,
  );
  assert.equal(
    scheduleOrgChangeSchema.safeParse({ ...base, unitKind: "TEAM", newParentId: null }).success,
    false,
  );
  assert.equal(
    scheduleOrgChangeSchema.safeParse({ ...base, unitKind: "TEAM", newName: "Ops" }).success,
    true,
  );
  assert.equal(
    scheduleOrgChangeSchema.safeParse({
      ...base,
      unitKind: "TEAM",
      newName: "Ops",
      effectiveDate: "1 Jan",
    }).success,
    false,
  );
});

test("AC-2.2 changes apply through the org services (same rules) and fail with a reason", () => {
  const src = readFileSync("lib/org/changes.ts", "utf8");
  assert.match(src, /renameDirectorate\(row\.unitId, name\)/);
  assert.match(src, /updateOrgDepartment\(row\.unitId,/);
  assert.match(src, /updateTeam\(row\.unitId,/);
  assert.match(src, /status: "FAILED", failureReason:/);
  // History is kept: rows are never deleted.
  assert.doesNotMatch(src, /orgUnitChange\.delete/);
  const sweep = readFileSync("lib/jml/sweep.ts", "utf8");
  assert.match(sweep, /name: "orgChangesDue", run: applyDueOrgChanges/);
});

test("AC-2.3 reorganisation routes are org-manager only", () => {
  for (const f of ["app/api/org/changes/route.ts", "app/api/org/changes/[id]/route.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /if \(!actor\.capabilities\.orgManage\) return forbidden\(\);/, f);
    assert.match(src, /withRateLimit\(\s*withAuth\(/, f);
  }
});

test("AC-1.2 open roles on the chart are for org-wide readers only", () => {
  const src = readFileSync("app/[locale]/(dashboard)/org/page.tsx", "utf8");
  assert.match(src, /actor\.capabilities\.orgWide \? await openRolesByDepartment\(\) : null/);
  assert.match(src, /status: \{ in: \["OPEN", "REOPENED"\] \}/);
});
