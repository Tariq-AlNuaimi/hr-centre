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
