import test from "node:test";
import assert from "node:assert/strict";

import { LEFTOVER_REASON, refreshCase } from "../../lib/jml/engine/tasks";

/**
 * QA run 2 (2026-10-29) regressions in JML. Each test was written failing first.
 */

type Task = { id: string; stage: string; status: string; mandatory: boolean; name: string };

function fakeTx(kase: Record<string, unknown>, tasks: Task[]) {
  const taskUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const tx = {
    jmlCase: {
      findUnique: async () => kase,
      update: async () => ({ id: "c1" }),
    },
    jmlTask: {
      findMany: async () => tasks,
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        taskUpdates.push(args);
        return { id: args.where.id };
      },
    },
    employee: { update: async () => ({ id: "e1" }) },
    jmlMoveDetail: { update: async () => ({ caseId: "c1" }) },
  };
  return { tx: tx as never, taskUpdates };
}

test("N-04 a mover completing with optional routed tasks open closes them EXPLICITLY, with a reason", async () => {
  const { tx, taskUpdates } = fakeTx(
    {
      caseType: "MOVE",
      status: "ACTIVE",
      stage: "FIRST_WEEK",
      joinDetail: null,
      moveDetail: { effectiveDate: new Date("2099-01-01T00:00:00Z") },
    },
    [
      { id: "m1", stage: "PREBOARDING", status: "COMPLETED", mandatory: true, name: "HR" },
      { id: "t20", stage: "FIRST_DAY", status: "NOT_STARTED", mandatory: false, name: "IT" },
      { id: "t21", stage: "FIRST_WEEK", status: "IN_PROGRESS", mandatory: false, name: "LM" },
      { id: "t22", stage: "FIRST_WEEK", status: "COMPLETED", mandatory: false, name: "done" },
    ],
  );
  const r = await refreshCase(tx, "c1", null);
  assert.equal(r.completedNow, true);
  assert.deepEqual(
    taskUpdates.map((u) => u.where.id).sort(),
    ["t20", "t21"],
    "only the still-open optional tasks are closed",
  );
  for (const u of taskUpdates) {
    assert.equal(u.data.status, "NOT_APPLICABLE");
    assert.equal(u.data.notApplicableReason, LEFTOVER_REASON);
  }
});

test("N-04 an ordinary refresh that does not complete the case closes nothing", async () => {
  const { tx, taskUpdates } = fakeTx(
    {
      caseType: "MOVE",
      status: "ACTIVE",
      stage: "PREBOARDING",
      joinDetail: null,
      moveDetail: { effectiveDate: new Date("2099-01-01T00:00:00Z") },
    },
    [
      { id: "m1", stage: "PREBOARDING", status: "NOT_STARTED", mandatory: true, name: "HR" },
      { id: "t20", stage: "FIRST_DAY", status: "NOT_STARTED", mandatory: false, name: "IT" },
    ],
  );
  const r = await refreshCase(tx, "c1", null);
  assert.equal(r.completedNow, false);
  assert.equal(taskUpdates.length, 0);
});

// --- N-08 / N-09 — date sanity ---------------------------------------------------

import { createMoveSchema } from "../../lib/validations/jml/move";
import { accessCutoffSchema } from "../../lib/validations/jml/leave";
import { localInputToInstant } from "../../lib/jml/leave/cutoff";

const ymd = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const move = (effectiveDate: string) =>
  createMoveSchema.safeParse({
    employeeId: "e1",
    changeType: "DEPARTMENT_TRANSFER",
    effectiveDate,
    newDetails: { jobTitle: "Engineer" },
  });

test("N-08 a mover effective date years in the past (2020) or far ahead is refused", () => {
  assert.equal(move("2020-01-01").success, false);
  assert.equal(move(ymd(-120)).success, false);
  assert.equal(move(ymd(400)).success, false);
  assert.equal(move(ymd(-30)).success, true, "a recent backdate is a normal catch-up");
  assert.equal(move(ymd(14)).success, true);
});

test("N-09 an impossible access cut-off (2026-02-30T10:00) is refused, never rolled to March", () => {
  assert.equal(accessCutoffSchema.safeParse({ at: "2026-02-30T10:00" }).success, false);
  assert.equal(accessCutoffSchema.safeParse({ at: "2026-02-28T24:00" }).success, false);
  assert.equal(accessCutoffSchema.safeParse({ at: "2026-02-28T10:00" }).success, true);
  assert.equal(localInputToInstant("2026-02-30T10:00", "Asia/Muscat"), null);
  assert.ok(localInputToInstant("2026-02-28T10:00", "Asia/Muscat"));
});

// --- N-11 — the joiner's IT answers decide the laptop / access-card tasks -------

import { taskApplies } from "../../lib/jml/engine/conditions";
import { joinFacts } from "../../lib/jml/join/facts";
import { STARTER_JOIN_TEMPLATE } from "../../prisma/seed-jml-templates";

test("N-11 'No' to laptop and access card generates neither task; 'Yes' or unanswered does", () => {
  const task = (code: string) => STARTER_JOIN_TEMPLATE.tasks.find((t) => t.code === code)!;
  const base = {
    companyCode: "RIHAL",
    employmentType: "PERMANENT",
    contractTypeCode: null,
    nationality: "Omani",
    workLocation: "Muscat",
    payrollApplicable: true,
  };
  const no = joinFacts({ ...base, laptopRequired: false, accessCardRequired: false });
  const yes = joinFacts({ ...base, laptopRequired: true, accessCardRequired: true });
  const unknown = joinFacts(base);
  for (const code of ["T22", "T24"]) {
    assert.equal(taskApplies(task(code).conditions, no), false, `${code} with No`);
    assert.equal(taskApplies(task(code).conditions, yes), true, `${code} with Yes`);
    assert.equal(taskApplies(task(code).conditions, unknown), true, `${code} unanswered`);
  }
});
