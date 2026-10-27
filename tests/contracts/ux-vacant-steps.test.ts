import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  approvalRoleLabel,
  assertChainStaffed,
  vacantSteps,
  type RoutedStep,
} from "../../lib/hiring/approval-config";
import { vacantRoles } from "../../components/hiring/ui/vacant-steps";

/** UX review P0-1 (docs/blueprints/ux-p0.md, US-3): no approval may route to a step nobody holds. */

const step = (sequence: number, role: RoutedStep["role"], ids: string[]): RoutedStep => ({
  sequence,
  role,
  approvers: ids.map((id) => ({ id, name: id, email: `${id}@x` })),
});

test("a step with no holder is vacant; a step with one is not", () => {
  const chain = [step(1, "HR_MANAGER", ["hrm"]), step(2, "COO", [])];
  assert.deepEqual(
    vacantSteps(chain).map((s) => s.role),
    ["COO"],
  );
});

test("a step held only by someone who may not decide it (the referrer) is vacant too", () => {
  const chain = [step(1, "HR_MANAGER", ["ref"])];
  assert.equal(vacantSteps(chain, ["ref"]).length, 1);
  assert.equal(vacantSteps(chain, [null, undefined]).length, 0);
});

test("the refusal names the step, says where to fix it, and is a 409 with a code", () => {
  assert.doesNotThrow(() => assertChainStaffed([step(1, "CEO", ["ceo"])]));
  assert.throws(
    () => assertChainStaffed([step(1, "OPERATIONS_DIRECTOR", []), step(2, "COO", [])]),
    (e: Error & { status?: number; code?: string }) =>
      e.status === 409 &&
      e.code === "VACANT_APPROVAL_STEP" &&
      /Operations director, COO/.test(e.message) &&
      /Admin → Roles/.test(e.message),
  );
});

test("role labels read as words", () => {
  assert.equal(approvalRoleLabel("HR_MANAGER"), "HR manager");
  assert.equal(approvalRoleLabel("DEPARTMENT_HEAD"), "Department head");
  assert.equal(approvalRoleLabel("COO"), "COO");
});

test("the UI reads vacancy the same way the server does", () => {
  assert.deepEqual(
    vacantRoles([
      { role: "COO", approvers: [] },
      { role: "CEO", approvers: [{ id: "a" }] },
    ]),
    ["COO"],
  );
});

test("every submit path checks the chain before it commits", () => {
  const offer = readFileSync("lib/hiring/offer-write.ts", "utf8");
  assert.match(offer, /to === "PENDING_APPROVAL"[\s\S]*assertChainStaffed\(/);
  assert.match(readFileSync("lib/hiring/offer-versions.ts", "utf8"), /assertChainStaffed\(/);
  assert.match(
    readFileSync("lib/hiring/requisition-status.ts", "utf8"),
    /to === "PENDING_APPROVAL"[\s\S]*assertChainStaffed\(/,
  );
  assert.match(
    readFileSync("lib/hiring/requisition-write.ts", "utf8"),
    /mode === "submit"[\s\S]*assertChainStaffed\(/,
  );
  assert.match(
    readFileSync("lib/hiring/jd.ts", "utf8"),
    /action === "SUBMIT"\) \{\s*await assertHrSignerExists/,
  );
});
