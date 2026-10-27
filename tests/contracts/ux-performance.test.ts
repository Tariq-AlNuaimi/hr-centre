import { before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * UX P1 phase 7 (docs/blueprints/ux-p1-performance.md): the cycle console's
 * stage numbers and "Remind late", and the goal-setting roster's state filter.
 */

const mockApi = mock as unknown as {
  module: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};

const NOW = new Date("2027-01-20T10:00:00Z");
const rows = [
  { employeeId: "e1", managerId: "m1", goalSettingState: "COMPLETE", yearEndState: "NOT_STARTED" },
  {
    employeeId: "e2",
    managerId: "m1",
    goalSettingState: "AWAITING_EMPLOYEE",
    yearEndState: "NOT_STARTED",
  },
  {
    employeeId: "e3",
    managerId: "m2",
    goalSettingState: "AWAITING_MANAGER",
    yearEndState: "NOT_STARTED",
  },
  {
    employeeId: "e4",
    managerId: null,
    goalSettingState: "NOT_APPLICABLE",
    yearEndState: "NOT_APPLICABLE",
  },
];
let written: Array<{ recipientEmployeeId: string; dedupeKey: string; kind: string }> = [];
let overview: typeof import("../../lib/pms/cycle-overview");

before(async () => {
  mockApi.module(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        performanceCycle: {
          findUnique: async () => ({
            id: "c1",
            year: 2027,
            status: "OPEN",
            stages: [
              {
                kind: "GOAL_SETTING",
                opensAt: new Date("2026-12-01"),
                deadline: new Date("2027-01-15"),
                graceDays: 3,
              },
              {
                kind: "MID_YEAR",
                opensAt: new Date("2027-06-01"),
                deadline: new Date("2027-07-15"),
                graceDays: 3,
              },
              {
                kind: "YEAR_END",
                opensAt: new Date("2027-12-01"),
                deadline: new Date("2028-01-15"),
                graceDays: 3,
              },
            ],
          }),
        },
        entityScore: { count: async () => 0 },
        departmentScore: { count: async () => 2 },
        calibrationTarget: { count: async () => 0 },
      },
    },
  });
  mockApi.module(import.meta.resolve("../../lib/pms/status-query.ts"), {
    namedExports: { participantStatuses: async () => ({ rows, truncated: false }) },
  });
  mockApi.module(import.meta.resolve("../../lib/pms/notifications.ts"), {
    namedExports: {
      persistNotifications: async (pending: typeof written) => {
        written = pending;
        return { written: pending.length, duplicates: 0, failed: 0, pending: 0 };
      },
    },
  });
  overview = await import("../../lib/pms/cycle-overview");
});

test("the console counts completion and lateness per stage, from the roster's own engine", async () => {
  const o = await overview.cycleOverview("c1", NOW);
  const goal = o!.stages.find((s) => s.kind === "GOAL_SETTING")!;
  assert.equal(goal.state, "LOCKED");
  assert.equal(goal.late, 2, "two sets still owe a step after the deadline; N/A is not late");
  const year = o!.stages.find((s) => s.kind === "YEAR_END")!;
  assert.equal(year.late, 0, "nobody is late before a deadline");
  assert.equal(o!.stages.find((s) => s.kind === "MID_YEAR")!.completion, null);
  assert.deepEqual(
    o!.setup.map((s) => [s.key, s.done]),
    [
      ["stages", true],
      ["enrolled", true],
      ["scores", true],
      ["calibration", false],
    ],
  );
});

test("whoever owes the step is reminded — once per person, stage and day", async () => {
  const r = await overview.remindLate("c1", "GOAL_SETTING", NOW);
  assert.equal(r.reminded, 2);
  assert.deepEqual(written.map((w) => w.recipientEmployeeId).sort(), ["e2", "m2"]);
  assert.ok(written.every((w) => w.dedupeKey.endsWith(":2027-01-20")));
  assert.ok(written.every((w) => w.kind === "CYCLE_REMINDER"));
  // A stage whose deadline has not passed reminds nobody.
  assert.deepEqual(await overview.remindLate("c1", "YEAR_END", NOW), { reminded: 0 });
});

test("owedBy follows §5.1: the manager drafts, the employee signs, HR approves", () => {
  const row = { employeeId: "e", managerId: "m" };
  assert.equal(overview.owedBy("NOT_STARTED", row), "m");
  assert.equal(overview.owedBy("AWAITING_EMPLOYEE", row), "e");
  assert.equal(overview.owedBy("AWAITING_HR", row), null);
  assert.equal(overview.owedBy("COMPLETE", row), null);
});

test("the console and the reminder are HR-only; reminders are rate-limited", () => {
  for (const f of ["overview", "remind"]) {
    const src = readFileSync(`app/api/cycles/[id]/${f}/route.ts`, "utf8");
    assert.match(src, /if \(!canRunCycle\(actor\)\) return forbidden\(\)/);
  }
  assert.match(readFileSync("app/api/cycles/[id]/remind/route.ts", "utf8"), /limit: 10/);
});

test("the goal-setting state filter is a server-side query", () => {
  const src = readFileSync("app/api/cycles/[id]/participants/route.ts", "utf8");
  assert.match(src, /\.\.\.stateWhere\(state\)/);
  assert.match(src, /state: z\.enum\(GOAL_STATES\)\.optional\(\)/);
});
