import { test } from "node:test";
import assert from "node:assert/strict";
import { departmentPlacementProblem, retireRefusal } from "../../lib/org/rules";
import { checkUnits } from "../../lib/pms/import/checks/units";
import { effectiveTeamId } from "../../lib/pms/import/reconcile";
import { planDigest, type EmployeeSourceRow, type ValidatedRow } from "../../lib/pms/import/types";
import type { ValidationContext } from "../../lib/pms/import/validate";
import {
  createOrgDepartmentSchema,
  updateOrgDepartmentSchema,
  updateTeamSchema,
} from "../../lib/validations/org";
import { decodePlacement, encodePlacement } from "../../components/org/placement";

/**
 * HR Centre foundation F-a — org structure (blueprint AC-F1.1–AC-F1.3, AC-F5.1).
 * The DB backstops (composite FKs) are exercised by the migration; these pin the
 * service-side rules and the import's treatment of the new columns.
 */

test("AC-F1.1: a directorate from another company is refused", () => {
  assert.equal(departmentPlacementProblem({ entityId: "rihal", directorate: null }), null);
  assert.equal(
    departmentPlacementProblem({ entityId: "rihal", directorate: { entityId: "rihal" } }),
    null,
  );
  assert.match(
    departmentPlacementProblem({ entityId: "cl", directorate: { entityId: "rihal" } }) ?? "",
    /different company/,
  );
});

test("AC-F1.3: retiring a unit with people is refused with the count", () => {
  assert.match(retireRefusal("team", { people: 3 }) ?? "", /3 people/);
  assert.match(retireRefusal("department", { people: 1 }) ?? "", /1 person/);
  assert.match(retireRefusal("directorate", { departments: 2 }) ?? "", /2 departments/);
  assert.equal(retireRefusal("team", { people: 0 }), null);
});

test("org schemas: department placement defaults to directly-under-company", () => {
  const parsed = createOrgDepartmentSchema.parse({ name: " Data ", entityId: "e1" });
  assert.deepEqual(parsed, { name: "Data", entityId: "e1", directorateId: null });
  assert.equal(updateOrgDepartmentSchema.safeParse({}).success, false, "empty patch refused");
  assert.equal(updateTeamSchema.safeParse({ name: "" }).success, false);
});

test("placement select round-trips company and directorate", () => {
  assert.deepEqual(decodePlacement(encodePlacement("e1", null)), {
    entityId: "e1",
    directorateId: null,
  });
  assert.deepEqual(decodePlacement(encodePlacement("e1", "d1")), {
    entityId: "e1",
    directorateId: "d1",
  });
});

// --- import ------------------------------------------------------------------

function ctx(): ValidationContext {
  return {
    departmentsByEntityAndName: new Map(),
    departmentsByName: new Map(),
    entitiesByKey: new Map(),
    existingOdooIds: new Set(),
    emailOwners: new Map(),
    directorateKeys: new Set(["rihal::technology", "rihal::operations"]),
    departmentDirectorates: new Map([
      ["dept-data", { key: "technology", name: "Technology" }],
      ["dept-cl-sales", null],
    ]),
    teamsByDepartmentAndName: new Map([["dept-data::platform", "team-platform"]]),
  };
}

function row(over: Partial<EmployeeSourceRow>): EmployeeSourceRow {
  return {
    rowNumber: 2,
    odooId: "E1",
    name: "A",
    email: "a@rihal.om",
    dateOfJoining: null,
    department: "Data",
    entity: "Rihal",
    managerOdooId: "B",
    roleTrack: "Individual",
    basicSalary: null,
    status: "Active",
    lastWorkingDay: null,
    unpaidLeaveDays: "0",
    ...over,
  };
}

const DATA = { entityId: "rihal", departmentId: "dept-data" };

test("AC-F5.1: a sheet without Team/Directorate columns leaves teams alone", () => {
  const out = checkUnits(row({}), DATA, "INDIVIDUAL", ctx());
  assert.deepEqual(out, { value: { teamId: undefined }, issues: [] });
});

test("AC-F5.1: a known team resolves; a blank Team cell clears it", () => {
  assert.equal(
    checkUnits(row({ team: "Platform" }), DATA, "INDIVIDUAL", ctx()).value.teamId,
    "team-platform",
  );
  assert.equal(checkUnits(row({ team: null }), DATA, "INDIVIDUAL", ctx()).value.teamId, null);
});

test("worst path: a team under the wrong department is flagged, never created", () => {
  const out = checkUnits(
    row({ team: "Platform", department: "Sales" }),
    { entityId: "cl", departmentId: "dept-cl-sales" },
    "INDIVIDUAL",
    ctx(),
  );
  assert.equal(out.issues[0]?.rule, "team_unknown");
  assert.match(out.issues[0]?.message ?? "", /never create teams/);
});

test("directorate column: unknown and mismatched directorates are rejected", () => {
  const unknown = checkUnits(row({ directorate: "Finance" }), DATA, "INDIVIDUAL", ctx());
  assert.equal(unknown.issues[0]?.rule, "directorate_unknown");
  const mismatch = checkUnits(row({ directorate: "Operations" }), DATA, "INDIVIDUAL", ctx());
  assert.equal(mismatch.issues[0]?.rule, "directorate_mismatch");
  const fine = checkUnits(row({ directorate: "technology" }), DATA, "INDIVIDUAL", ctx());
  assert.equal(fine.issues.length, 0);
});

test("C-Level rows may not name a team or directorate", () => {
  const out = checkUnits(
    row({ team: "Platform", directorate: "Technology", department: null }),
    { entityId: "rihal", departmentId: null },
    "C_LEVEL",
    ctx(),
  );
  assert.deepEqual(
    out.issues.map((i) => i.rule),
    ["c_level_has_directorate", "c_level_has_team"],
  );
});

test("effectiveTeamId: a team never follows its member into another department", () => {
  const existing = { teamId: "t1", departmentId: "d1" };
  assert.equal(effectiveTeamId({ teamId: undefined, departmentId: "d1" }, existing), "t1");
  assert.equal(effectiveTeamId({ teamId: undefined, departmentId: "d2" }, existing), null);
  assert.equal(effectiveTeamId({ teamId: null, departmentId: "d1" }, existing), null);
  assert.equal(effectiveTeamId({ teamId: "t2", departmentId: "d1" }, existing), "t2");
  assert.equal(effectiveTeamId({ teamId: undefined, departmentId: "d1" }, undefined), null);
});

test("planDigest: a team change alone changes the digest", () => {
  const base: ValidatedRow = {
    rowNumber: 2,
    odooId: "E1",
    name: "A",
    email: "a@rihal.om",
    departmentId: "d1",
    entityId: "rihal",
    managerOdooId: null,
    roleTrack: "INDIVIDUAL",
    basicSalary: null,
    status: "ACTIVE",
    dateOfJoining: null,
    lastWorkingDay: null,
    unpaidLeaveDays: 0,
  };
  const a = planDigest([{ ...base, teamId: "t1" }]);
  assert.notEqual(a, planDigest([{ ...base, teamId: "t2" }]));
  assert.notEqual(planDigest([{ ...base, teamId: null }]), planDigest([base]));
});
