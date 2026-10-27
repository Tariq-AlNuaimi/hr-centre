import test from "node:test";
import assert from "node:assert/strict";

import { formatDate, formatDateTime } from "../../lib/format";
import { isLive } from "../../lib/jml/vocab";
import { withCaseRefRetry } from "../../lib/jml/engine/case-ref";
import { paymentDeadline } from "../../lib/jml/leave/settlement-rules";
import { isStatutoryKey, STATUTORY_KEYS } from "../../lib/statutory/parameters";
import { defaultDueAt, isThresholdLocked } from "../../lib/hiring/assessment-rules";
import { icsHeaders } from "../../lib/hiring/ics";
import { partialScopes } from "../../lib/rbac/grants";
import { StorageNotConfiguredError, isStorageConfigured } from "../../lib/storage";
import { EmployeeCodeError } from "../../lib/people/employee-code";
import { initialsOf } from "../../lib/hiring/scorecard-math";
import { isLocalHour } from "../../lib/working-time/calendar";
import { reopenData } from "../../lib/jml/engine/task-status-rules";

/**
 * Small pure helpers the contract suite never called (the lib/** function
 * coverage floor fell below 78% on main after the QA snapshot). Each test pins
 * real behaviour, not just a call.
 */

test("format: dates and date-times render a stable, non-empty string", () => {
  const d = new Date("2026-10-27T08:30:00Z");
  assert.match(formatDate(d), /2026/);
  assert.match(formatDateTime(d.toISOString()), /2026/);
  assert.ok(formatDateTime(d).length > formatDate(d).length);
});

test("vocab: a live case is one HR is still working", () => {
  assert.equal(isLive("ACTIVE"), true);
  assert.equal(isLive("CANCELLED"), false);
  assert.equal(isLive("DRAFT"), false);
});

test("case-ref: a case-ref unique clash is retried; anything else is not", async () => {
  let calls = 0;
  const clash = Object.assign(new Error("dup"), { code: "P2002", meta: { target: ["case_ref"] } });
  const ok = await withCaseRefRetry(async () => {
    calls += 1;
    if (calls < 3) throw clash;
    return "done";
  });
  assert.equal(ok, "done");
  assert.equal(calls, 3);
  const other = Object.assign(new Error("other"), { code: "P2002", meta: { target: ["email"] } });
  await assert.rejects(() => withCaseRefRetry(async () => Promise.reject(other)), /other/);
  await assert.rejects(() => withCaseRefRetry(async () => Promise.reject(clash), 2), /dup/);
});

test("settlement: the payment deadline is the last day plus the window, in calendar days", () => {
  assert.equal(
    paymentDeadline(new Date("2026-10-01T00:00:00Z"), 15).toISOString().slice(0, 10),
    "2026-10-16",
  );
});

test("statutory: only catalogued keys are statutory keys", () => {
  assert.equal(isStatutoryKey(STATUTORY_KEYS[0]!), true);
  assert.equal(isStatutoryKey("not.a.key"), false);
});

test("assessment: a threshold locks after the first result; the default due date is a week", () => {
  assert.equal(isThresholdLocked(0), false);
  assert.equal(isThresholdLocked(1), true);
  const now = new Date("2026-10-27T00:00:00Z");
  assert.equal(defaultDueAt(now).toISOString().slice(0, 10), "2026-11-03");
  assert.equal(defaultDueAt(now, 1).toISOString().slice(0, 10), "2026-10-28");
});

test("ics: a calendar download is uncached and its filename cannot break the header", () => {
  const h = icsHeaders('Interview "x"; y/z.ics');
  assert.equal(h["cache-control"], "no-store");
  assert.match(h["content-type"], /text\/calendar/);
  assert.doesNotMatch(h["content-disposition"].slice(22, -1), /["/; ]/);
});

test("rbac: partial scopes are empty for a group-wide grant, the scopes otherwise", () => {
  const scoped = new Map([["people.view", [{ type: "COMPANY", id: "c1" }]]]) as never;
  assert.deepEqual(partialScopes(scoped, "people.view"), [{ type: "COMPANY", id: "c1" }]);
  const group = new Map([["people.view", [{ type: "GROUP" }]]]) as never;
  assert.deepEqual(partialScopes(group, "people.view"), []);
  assert.deepEqual(partialScopes(new Map() as never, "people.view"), []);
});

test("storage: unconfigured storage is reported honestly", () => {
  const saved = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    assert.equal(isStorageConfigured(), false);
    const e = new StorageNotConfiguredError();
    assert.match(e.message, /not configured/);
  } finally {
    if (saved !== undefined) process.env.BLOB_READ_WRITE_TOKEN = saved;
  }
});

test("employee code: its error is named so routes can map it", () => {
  const e = new EmployeeCodeError("taken");
  assert.equal(e.name, "EmployeeCodeError");
  assert.equal(e.message, "taken");
});

test("scorecard: initials come from the first and last names", () => {
  assert.equal(initialsOf("Layla Al Harthy"), "LH");
  assert.equal(initialsOf("  saif "), "S");
  assert.equal(initialsOf(""), "?");
});

test("calendar: the local hour is read in the given zone", () => {
  const at = new Date("2026-10-27T23:00:00Z"); // 03:00 in Muscat
  assert.equal(isLocalHour(at, 3, "Asia/Muscat"), true);
  assert.equal(isLocalHour(at, 23, "Asia/Muscat"), false);
});

test("task reopen: free for joiners; a leaver task needs Senior HR, In progress and a reason", () => {
  const actor = { userId: "u1", grants: new Map() } as never;
  const join = { caseType: "JOIN", subject: {} } as never;
  assert.deepEqual(reopenData(actor, join, "IN_PROGRESS", {}), {
    completedAt: null,
    completedBy: { disconnect: true },
  });
  const leave = { caseType: "LEAVE", subject: {} } as never;
  assert.throws(() => reopenData(actor, leave, "IN_PROGRESS", { reason: "x" }), /reopen/);
});

test("round plan: equal round orders fall back to the canonical order; unscheduled rounds follow", async () => {
  const { buildRoundPlan } = await import("../../lib/hiring/interview-rules");
  const plan = buildRoundPlan(
    [
      { round: "FINAL", roundOrder: 1, competencies: [], durationMinutes: 0 },
      { round: "SCREENING", roundOrder: 1, competencies: ["c"], durationMinutes: 30 },
    ],
    ["PANEL", "CUSTOM", "TECHNICAL"],
  );
  assert.deepEqual(
    plan.map((p) => p.round),
    ["SCREENING", "FINAL", "TECHNICAL", "PANEL", "CUSTOM"],
  );
  assert.equal(plan[1]!.durationMinutes, 60, "a zero duration takes the default");
  assert.equal(plan[4]!.configured, false);
});

test("statutory parameter: dates become UTC days; an open end is null", async () => {
  const { statutoryCreateSchema } = await import("../../lib/validations/jml/config");
  const r = statutoryCreateSchema.parse({
    key: "gratuity.x",
    value: "15",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
  });
  assert.equal(r.effectiveFrom.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(r.effectiveTo?.toISOString(), "2026-12-31T00:00:00.000Z");
  assert.equal(
    statutoryCreateSchema.parse({ key: "gratuity.x", value: "1", effectiveFrom: "2026-01-01" })
      .effectiveTo,
    null,
  );
});

test("joiner draft: blank text and emails become null; a contract cannot end before it starts", async () => {
  const { draftJoinerSchema } = await import("../../lib/validations/jml/joiner");
  const base = { fullName: "Salim", entityId: "e1", workEmail: "", phone: "", jobTitle: "  " };
  const r = draftJoinerSchema.parse(base);
  assert.equal(r.workEmail, null);
  assert.equal(r.phone, null);
  assert.equal(r.jobTitle, null);
  const bad = draftJoinerSchema.safeParse({
    ...base,
    contractStartDate: "2026-11-01",
    contractEndDate: "2026-10-01",
  });
  assert.equal(bad.success, false);
  assert.match(bad.error!.issues[0]!.message, /cannot end before it starts/);
});

test("employee record: blanks clear, IDs normalise, emails lower-case, no future birthday", async () => {
  const { employeeRecordSchema } = await import("../../lib/validations/people");
  const r = employeeRecordSchema.parse({
    jobTitle: "",
    workPhone: "",
    personalEmail: "Saif@Example.COM",
    civilIdNumber: " ab 12 345 ",
    passportNumber: "",
  });
  assert.equal(r.jobTitle, null);
  assert.equal(r.workPhone, null);
  assert.equal(r.personalEmail, "saif@example.com");
  assert.equal(r.civilIdNumber, "AB12345");
  assert.equal(r.passportNumber, null);
  assert.equal(employeeRecordSchema.safeParse({ civilIdNumber: "x!" }).success, false);
  assert.equal(employeeRecordSchema.safeParse({ dateOfBirth: "2999-01-01" }).success, false);
});
