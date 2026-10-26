import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  applyChangeRules,
  changedFields,
  changeRefusal,
  overlayDetails,
  type EmployeeDetails,
} from "../../lib/jml/move/rules";
import { STARTER_MOVE_TEMPLATES } from "../../prisma/seed-jml-templates";
import { conditionsSchema } from "../../lib/validations/jml/template";
import { createMoveSchema } from "../../lib/validations/jml/move";

/** JML S4 — movers (HR Onboarding R1–R10; docs/blueprints/jml-s4-movers.md). */

const CURRENT: EmployeeDetails = {
  entityId: "rihal",
  departmentId: "eng",
  teamId: "team-a",
  jobTitle: "Intern",
  employmentType: "INTERN",
  contractTypeId: null,
  workLocation: "Muscat",
  managerId: "m1",
};

test("R4 eligibility: only an active employee changes", () => {
  assert.equal(changeRefusal({ name: "A", status: "ACTIVE" }), null);
  assert.match(changeRefusal({ name: "A", status: "PRE_JOINER" })!, /has not started/);
  assert.match(changeRefusal({ name: "A", status: "LEAVER" })!, /no longer an active employee/);
});

test("overlay: undefined keeps, null/empty clears; a new department drops the old team", () => {
  const next = overlayDetails(CURRENT, {
    jobTitle: "Trainee engineer",
    workLocation: "",
    departmentId: "ops",
  });
  assert.equal(next.jobTitle, "Trainee engineer");
  assert.equal(next.workLocation, null);
  assert.equal(next.managerId, "m1");
  assert.equal(next.teamId, null);
});

test("R5: internship to training forces TRAINEE and needs a current intern", () => {
  const out = applyChangeRules("INTERNSHIP_TO_TRAINING", CURRENT, overlayDetails(CURRENT, {}));
  assert.equal(out.employmentType, "TRAINEE");
  assert.throws(
    () =>
      applyChangeRules("INTERNSHIP_TO_TRAINING", CURRENT, {
        ...CURRENT,
        employmentType: "PERMANENT",
      }),
    /makes the employee a trainee/,
  );
  assert.throws(
    () =>
      applyChangeRules(
        "INTERNSHIP_TO_TRAINING",
        { ...CURRENT, employmentType: "PERMANENT" },
        CURRENT,
      ),
    /needs a current intern/,
  );
});

test("R5: to employment needs a new type that is not intern or trainee", () => {
  assert.throws(
    () => applyChangeRules("INTERNSHIP_TO_EMPLOYMENT", CURRENT, CURRENT),
    /Choose the new employment type/,
  );
  const ok = applyChangeRules("INTERNSHIP_TO_EMPLOYMENT", CURRENT, {
    ...CURRENT,
    employmentType: "PERMANENT",
  });
  assert.equal(ok.employmentType, "PERMANENT");
  assert.throws(
    () =>
      applyChangeRules("TRAINING_TO_EMPLOYMENT", CURRENT, {
        ...CURRENT,
        employmentType: "PERMANENT",
      }),
    /a current trainee/,
  );
});

test("R5: a department transfer needs a different department and keeps the employment type", () => {
  assert.throws(
    () => applyChangeRules("DEPARTMENT_TRANSFER", CURRENT, CURRENT),
    /current department/,
  );
  const out = applyChangeRules("DEPARTMENT_TRANSFER", CURRENT, {
    ...CURRENT,
    departmentId: "ops",
    employmentType: "PERMANENT",
  });
  assert.equal(out.employmentType, "INTERN");
  assert.deepEqual(changedFields(CURRENT, out), ["departmentId"]);
});

test("R10: salary is never part of a change (the boundary refuses it)", () => {
  const parsed = createMoveSchema.safeParse({
    employeeId: "e",
    changeType: "DEPARTMENT_TRANSFER",
    effectiveDate: "2026-12-01",
    newDetails: { departmentId: "ops", salary: "2000" },
  });
  assert.equal(parsed.success, false);
});

test("one starter per change type, schema-valid conditions", () => {
  const types = STARTER_MOVE_TEMPLATES.map((t) => t.changeType).sort();
  assert.deepEqual(types, [
    "DEPARTMENT_TRANSFER",
    "INTERNSHIP_TO_EMPLOYMENT",
    "INTERNSHIP_TO_TRAINING",
    "TRAINING_TO_EMPLOYMENT",
  ]);
  for (const tpl of STARTER_MOVE_TEMPLATES) {
    assert.equal(tpl.dateBasis, "EFFECTIVE_DATE");
    assert.equal(new Set(tpl.tasks.map((t) => t.code)).size, tpl.tasks.length, tpl.name);
    for (const task of tpl.tasks)
      assert.ok(conditionsSchema.safeParse(task.conditions ?? {}).success);
  }
});

test("D9: a completed MOVE applies through the shared transfer split", () => {
  const tasks = readFileSync("lib/jml/engine/tasks.ts", "utf8");
  assert.match(tasks, /completedNow && kase\.caseType === "MOVE"\) await applyMove\(tx, caseId\)/);
  const route = readFileSync("app/api/transfers/route.ts", "utf8");
  assert.match(route, /splitAndMove\(tx,/);
  const apply = readFileSync("lib/jml/move/apply.ts", "utf8");
  assert.match(apply, /splitAndMove\(tx,/);
});
