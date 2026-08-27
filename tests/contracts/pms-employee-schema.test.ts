import { test } from "node:test";
import assert from "node:assert/strict";
import { updateEmployeeSchema } from "../../lib/validations/employee";

/**
 * `updateEmployeeSchema` is the boundary for §3's hand-editing path — the one
 * `lib/validations/employee.ts` opens by naming ("HR fixing one record in the
 * UI"). It guards `PUT /api/employees/[id]` AND, since F12, the edit form, which
 * binds it as its resolver so the two cannot drift.
 *
 * These cases pin §3.3's Date of Joining, which was absent from the schema until
 * F13 even though §3.3 lists it as required and names it the anchor for §11's
 * eligibility gate and pro-ration. The two date rules mirror the database's own
 * CHECK constraints; they live here as well so the message lands on a field
 * rather than arriving as a constraint violation.
 */

const base = {
  name: "Noura Al-Siyabi",
  email: "noura@rihal.example",
  dateOfJoining: "2022-03-01",
  departmentId: "dep-1",
  entityId: "ent-1",
  managerId: "mgr-1",
  roleTrack: "INDIVIDUAL" as const,
  pmsRoles: [],
  basicSalary: "1200",
  status: "ACTIVE" as const,
  lastWorkingDay: null,
  unpaidLeaveDays: 0,
};

const issuesFor = (input: Record<string, unknown>) => {
  const parsed = updateEmployeeSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

test("§3.3 a date of joining round-trips through the update schema", () => {
  const parsed = updateEmployeeSchema.safeParse(base);
  assert.equal(parsed.success, true, JSON.stringify(issuesFor(base)));
  assert.equal(parsed.success && parsed.data.dateOfJoining, "2022-03-01");
});

test("§3.3 NULL is accepted — the column was never backfilled", () => {
  // The migration added it nullable and did not backfill, so every employee
  // imported before it carries null. Requiring a date here would make the form
  // refuse to open exactly the records that need fixing: HR could not correct a
  // misspelt name on someone whose joining date was never captured.
  const parsed = updateEmployeeSchema.safeParse({ ...base, dateOfJoining: null });
  assert.equal(parsed.success, true, JSON.stringify(issuesFor({ ...base, dateOfJoining: null })));
});

test("§3.3 a non-date is refused on its own field", () => {
  // Both checks report on a malformed string: the shape rule and the calendar
  // rule are independent, and zod does not short-circuit one on the other. Two
  // messages on the right field is the honest outcome, so the assertion says so
  // rather than being loosened to a substring match.
  assert.deepEqual(issuesFor({ ...base, dateOfJoining: "01/03/2022" }), [
    "dateOfJoining: Use YYYY-MM-DD",
    "dateOfJoining: Not a real calendar date",
  ]);
  // A well-formed date that does not exist trips only the calendar rule — which
  // is the case the regex alone would have let through.
  assert.deepEqual(issuesFor({ ...base, dateOfJoining: "2022-02-30" }), [
    "dateOfJoining: Not a real calendar date",
  ]);
});

test("a joining date more than a year out is a typo, not a hire", () => {
  const farFuture = new Date();
  farFuture.setUTCFullYear(farFuture.getUTCFullYear() + 3);
  const issues = issuesFor({ ...base, dateOfJoining: farFuture.toISOString().slice(0, 10) });
  assert.deepEqual(issues, [
    "dateOfJoining: That joining date is more than a year away — check it for a typo",
  ]);

  // A signed offer with a start date a few months out is a real thing HR records
  // ahead of time, so the bound is generous rather than "not in the future".
  const soon = new Date();
  soon.setUTCMonth(soon.getUTCMonth() + 2);
  assert.deepEqual(issuesFor({ ...base, dateOfJoining: soon.toISOString().slice(0, 10) }), []);
});

test("§11.4 nobody leaves before they join", () => {
  const issues = issuesFor({
    ...base,
    status: "LEAVER",
    dateOfJoining: "2024-05-01",
    lastWorkingDay: "2023-01-31",
  });
  assert.deepEqual(issues, [
    "lastWorkingDay: The last working day cannot be before the date of joining",
  ]);

  // The same pair the right way round is fine.
  assert.deepEqual(
    issuesFor({
      ...base,
      status: "LEAVER",
      dateOfJoining: "2023-01-01",
      lastWorkingDay: "2024-05-31",
    }),
    [],
  );
});

test("§1.2's exclusive-or still holds alongside the new rules", () => {
  // A guard on the guard: the two date refinements were appended to
  // `applyOrgInvariants`, which both create and update share. A refinement chain
  // that silently stopped running its earlier links would be invisible.
  assert.deepEqual(issuesFor({ ...base, roleTrack: "C_LEVEL" }), [
    "departmentId: C-Level employees are tagged to an entity directly and have no department",
  ]);
  assert.deepEqual(issuesFor({ ...base, departmentId: null }), [
    "departmentId: A department is required for every track except C-Level",
  ]);
  assert.deepEqual(issuesFor({ ...base, managerId: null }), [
    "managerId: A manager is required for every track except C-Level",
  ]);
  assert.deepEqual(issuesFor({ ...base, status: "LEAVER" }), [
    "lastWorkingDay: A leaver needs a last working day — it sets the bonus pro-ration period",
  ]);
});

// --- The six fields whose default was destructive on a full-replace update ---
//
// Raised by the post-push breadth review (2026-08-26) at low confidence,
// confirmed, and hardened on the operator's call. Each of these previously had a
// `.default()` inherited from `employeeCore` — right on a CREATE, silent data
// loss on an UPDATE, because PUT replaces the whole row.

test("an update that OMITS status is refused, not silently set to ACTIVE", () => {
  // The sharpest one. Defaulting to ACTIVE reactivates a leaver — and does it
  // WITHOUT restoring the login ADR-069's off-boarding revoked, leaving an active
  // employee whose account is soft-deleted: the exact state that amendment
  // exists to prevent.
  const { status: _omitted, ...withoutStatus } = base;
  const issues = issuesFor(withoutStatus);
  assert.ok(issues.length > 0, "a missing status must be an error");
  assert.ok(
    issues.some((i) => i.startsWith("status:")),
    `the error should name the field; got ${JSON.stringify(issues)}`,
  );
});

test("an update that OMITS pmsRoles is refused, not silently emptied", () => {
  // Defaulting to [] strips §4.1 authority from an HR Super Admin.
  const { pmsRoles: _omitted, ...withoutRoles } = base;
  assert.ok(
    issuesFor(withoutRoles).some((i) => i.startsWith("pmsRoles:")),
    "a missing pmsRoles must be an error naming the field",
  );
});

test("the other four destructive defaults are gone too", () => {
  // basicSalary → null wipes payroll (§11.3); unpaidLeaveDays → 0 wipes §11.5's
  // service reduction; dateOfJoining → null wipes §3.3's anchor and §11.7 then
  // refuses to compute a bonus at all; lastWorkingDay → null wipes §11.4's
  // pro-ration period.
  for (const field of ["basicSalary", "unpaidLeaveDays", "dateOfJoining", "lastWorkingDay"]) {
    const partial = { ...base };
    delete (partial as Record<string, unknown>)[field];
    assert.ok(
      issuesFor(partial).some((i) => i.startsWith(`${field}:`)),
      `omitting ${field} should be an error naming it`,
    );
  }
});

test("EXPLICIT null is still accepted where the column is nullable", () => {
  // "Send me null" is a decision; "send me nothing" is a mistake. Hardening the
  // second must not break the first — HR clearing a last working day, or editing
  // an employee whose joining date was never captured, are both legitimate.
  const cleared = { ...base, dateOfJoining: null, lastWorkingDay: null, basicSalary: null };
  assert.deepEqual(issuesFor(cleared), []);
});
