import test from "node:test";
import assert from "node:assert/strict";

import { isMoveDue, refreshCase } from "../../lib/jml/engine/tasks";
import { notApplicableData } from "../../lib/jml/engine/task-status-rules";

/**
 * QA 2026-10-27 regressions in the JML task engine:
 *  - D-02: a joiner whose checklist finishes before day one must not complete
 *    (it stranded them PRE_JOINER, because the start is confirmed on an ACTIVE case);
 *  - D-05: a mover's change is applied on its effective date, not when the
 *    checklist happens to complete;
 *  - D-09: a MANDATORY task cannot be set aside as Not applicable without a reason.
 */

type Task = {
  id: string;
  code: string | null;
  name: string;
  stage: string;
  status: string;
  mandatory: boolean;
  blocking: boolean;
};

const done = (stage: string, i: number): Task => ({
  id: `t${i}`,
  code: null,
  name: `Task ${i}`,
  stage,
  status: "COMPLETED",
  mandatory: true,
  blocking: false,
});

/** A fake transaction client: just the calls refreshCase / applyMove make. */
function fakeTx(kase: Record<string, unknown>, tasks: Task[]) {
  const updates: Array<Record<string, unknown>> = [];
  const employeeUpdates: unknown[] = [];
  const tx = {
    jmlCase: {
      findUnique: async () => kase,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return { id: "c1" };
      },
    },
    jmlTask: { findMany: async () => tasks },
    employee: {
      update: async (args: unknown) => {
        employeeUpdates.push(args);
        return { id: "e1" };
      },
    },
    jmlMoveDetail: { update: async () => ({ caseId: "c1" }) },
  };
  return { tx: tx as never, updates, employeeUpdates };
}

const ALL_DONE = [done("PREBOARDING", 1), done("FIRST_DAY", 2), done("FIRST_WEEK", 3)];

test("D-02: a finished checklist before day one keeps the joiner's case ACTIVE", async () => {
  const { tx, updates } = fakeTx(
    {
      caseType: "JOIN",
      status: "ACTIVE",
      stage: "FIRST_WEEK",
      joinDetail: { actualStartDate: null },
      moveDetail: null,
    },
    ALL_DONE,
  );
  const r = await refreshCase(tx, "c1", null);
  assert.equal(r.completedNow, false);
  assert.notEqual(r.stage, "COMPLETED");
  assert.equal(
    updates[0]!.status,
    undefined,
    "the case must stay ACTIVE so the start can be confirmed",
  );
});

test("D-02: once the start is confirmed, the same checklist completes the case", async () => {
  const { tx, updates } = fakeTx(
    {
      caseType: "JOIN",
      status: "ACTIVE",
      stage: "FIRST_DAY",
      joinDetail: { actualStartDate: new Date("2026-10-27T00:00:00Z") },
      moveDetail: null,
    },
    ALL_DONE,
  );
  const r = await refreshCase(tx, "c1", null);
  assert.equal(r.completedNow, true);
  assert.equal(updates[0]!.status, "COMPLETED");
});

const NOW = new Date("2026-10-27T08:00:00Z"); // 12:00 in Muscat

test("D-05: a mover completed before the effective date is NOT applied to the record", async () => {
  const effective = new Date("2026-11-10T00:00:00Z");
  const { tx, employeeUpdates } = fakeTx(
    {
      caseType: "MOVE",
      status: "ACTIVE",
      stage: "FIRST_WEEK",
      joinDetail: null,
      moveDetail: { effectiveDate: effective },
    },
    ALL_DONE,
  );
  const r = await refreshCase(tx, "c1", null, NOW);
  assert.equal(r.completedNow, true, "the checklist itself still completes");
  assert.equal(employeeUpdates.length, 0, "the employee record waits for the effective date");
});

test("D-05: isMoveDue follows the effective date in the organisation's time zone", () => {
  assert.equal(isMoveDue(new Date("2026-11-10T00:00:00Z"), NOW), false);
  assert.equal(isMoveDue(new Date("2026-10-27T00:00:00Z"), NOW), true);
  assert.equal(isMoveDue(new Date("2026-10-20T00:00:00Z"), NOW), true);
  // 21:00 UTC on the 27th is already the 28th in Muscat (UTC+4).
  assert.equal(isMoveDue(new Date("2026-10-28T00:00:00Z"), new Date("2026-10-27T21:00:00Z")), true);
});

const joinCase = { caseType: "JOIN" } as never;

test("D-09: a mandatory task needs a reason to be Not applicable, on every case type", () => {
  assert.throws(
    () => notApplicableData(joinCase, { mandatory: true, isReversal: false } as never, {}),
    /notApplicableReason/,
  );
  assert.deepEqual(
    notApplicableData(joinCase, { mandatory: true, isReversal: false } as never, {
      notApplicableReason: "Already has a laptop",
    }),
    { notApplicableReason: "Already has a laptop" },
  );
  // An optional joiner task may still be set aside without one.
  assert.deepEqual(
    notApplicableData(joinCase, { mandatory: false, isReversal: false } as never, {}),
    { notApplicableReason: null },
  );
});

test("D-04: an exit whose last day of service is before the notice start is refused", async () => {
  const { createExitSchema, exitDatesSchema } = await import("../../lib/validations/jml/leave");
  const base = {
    employeeId: "e1",
    exitType: "RESIGNATION",
    nationality: "OMANI",
    noticeStartDate: "2026-11-10",
    noticePeriodDays: 30,
  };
  const bad = createExitSchema.safeParse({ ...base, lastDayOfService: "2026-11-05" });
  assert.equal(bad.success, false);
  assert.deepEqual(bad.error?.issues[0]?.path, ["lastDayOfService"]);
  assert.equal(
    createExitSchema.safeParse({
      ...base,
      lastPhysicalWorkingDay: "2026-12-08",
      lastDayOfService: "2026-12-10",
    }).success,
    true,
  );
  assert.equal(
    exitDatesSchema.safeParse({ ...base, expectedVersion: 0, lastDayOfService: "2026-11-01" })
      .success,
    false,
    "the edit path refuses it too",
  );
});

test("D-13: one person cannot record both holders' decisions on a two-holder approval", async () => {
  const { segregationProblem } = await import("../../lib/jml/leave/approval-rules");
  const opsDir = { id: "a2", holderRoleKey: "Operations Director" };
  const siblings = [
    { id: "a1", holderRoleKey: "HR Manager", decidedById: "hr-1" },
    { id: "a2", holderRoleKey: "Operations Director", decidedById: null },
  ];
  assert.match(segregationProblem(opsDir, siblings, "hr-1", null) ?? "", /someone else/);
  assert.equal(
    segregationProblem(opsDir, siblings, "hr-2", null),
    null,
    "a second recorder is fine",
  );
  // A single-holder approval (exit confirmation) may be recorded on the holder's behalf.
  assert.equal(
    segregationProblem({ id: "x", holderRoleKey: "Line Manager" }, [], "hr-1", null),
    null,
  );
  assert.match(
    segregationProblem({ id: "x", holderRoleKey: "Line Manager" }, [], "leaver-u", "leaver-u") ??
      "",
    /your own exit/,
  );
});
