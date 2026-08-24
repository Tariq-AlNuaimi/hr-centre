import test from "node:test";
import assert from "node:assert/strict";

import {
  STAGE_ORDER,
  canActOnStage,
  canRunCycle,
  graceEndsAt,
  hoursOverdue,
  isGoalSettingExempt,
  isPastGrace,
  stageState,
  type StageWindow,
} from "../../lib/pms/cycle";
import type { PmsActor } from "../../lib/pms/permissions";
import { createCycleSchema, cycleStageSchema } from "../../lib/validations/cycle";

// A December goal-setting stage, which is the one §5.5 warns about: a long grace
// window here pushes HR's intervention past the cycle boundary.
const GOAL_SETTING: StageWindow = {
  kind: "GOAL_SETTING",
  opensAt: new Date("2026-12-01T00:00:00Z"),
  deadline: new Date("2026-12-31T23:59:59Z"),
  graceDays: 3,
};

const actor = (over: Partial<PmsActor> = {}): PmsActor => ({
  userId: "u1",
  employeeId: "e1",
  pmsRoles: [],
  isLineManager: false,
  ...over,
});

// --- §2 cadence -------------------------------------------------------------

test("§2 the cycle has exactly the three touchpoints, in order", () => {
  assert.deepEqual([...STAGE_ORDER], ["GOAL_SETTING", "MID_YEAR", "YEAR_END"]);
});

test("§2 a cycle cannot be created with a missing or duplicated touchpoint", () => {
  const stage = (kind: string, m: number) => ({
    kind,
    opensAt: `2026-${String(m).padStart(2, "0")}-01T00:00:00Z`,
    deadline: `2026-${String(m).padStart(2, "0")}-28T00:00:00Z`,
    graceDays: 3,
  });

  assert.equal(
    createCycleSchema.safeParse({ year: 2027, stages: [stage("GOAL_SETTING", 12)] }).success,
    false,
    "one stage is a half-configured year",
  );
  assert.equal(
    createCycleSchema.safeParse({
      year: 2027,
      stages: [stage("GOAL_SETTING", 12), stage("GOAL_SETTING", 11), stage("YEAR_END", 10)],
    }).success,
    false,
    "the same touchpoint twice is not three touchpoints",
  );
  assert.equal(
    createCycleSchema.safeParse({
      year: 2027,
      stages: [stage("GOAL_SETTING", 1), stage("MID_YEAR", 6), stage("YEAR_END", 12)],
    }).success,
    true,
  );
});

test("a deadline before the stage opens is refused at the boundary", () => {
  const parsed = cycleStageSchema.safeParse({
    kind: "GOAL_SETTING",
    opensAt: "2026-12-31T00:00:00Z",
    deadline: "2026-12-01T00:00:00Z",
    graceDays: 3,
  });
  assert.equal(parsed.success, false, "a stage that locks before it opens reads as a broken app");
});

// --- §5.4 hard locks --------------------------------------------------------

test("§5.4 a stage is not actionable before it opens", () => {
  const now = new Date("2026-11-30T23:59:59Z");
  assert.equal(stageState(GOAL_SETTING, now), "NOT_YET_OPEN");
  assert.equal(canActOnStage(GOAL_SETTING, now), false);
});

test("§5.4 a stage is actionable right up to the deadline instant", () => {
  assert.equal(canActOnStage(GOAL_SETTING, GOAL_SETTING.deadline), true, "at the deadline: open");
  assert.equal(
    canActOnStage(GOAL_SETTING, new Date(GOAL_SETTING.deadline.getTime() + 1)),
    false,
    "one millisecond past: locked, with no taper (§5.4)",
  );
});

test("§5.4 the lock does not soften with time, and grace does not reopen it", () => {
  // The single most tempting wrong implementation: treating the grace window as
  // extra time to act. §5.5's grace gates HR's INTERVENTION, not the party's
  // ability to act — §5.4 has already locked them out.
  const insideGrace = new Date("2027-01-02T00:00:00Z");
  assert.equal(isPastGrace(GOAL_SETTING, insideGrace), false, "still inside the grace window");
  assert.equal(
    canActOnStage(GOAL_SETTING, insideGrace),
    false,
    "and still locked — grace is not an extension",
  );
});

// --- §5.5 grace window ------------------------------------------------------

test("§5.5 the grace window runs from the deadline, not from the escalation", () => {
  assert.deepEqual(graceEndsAt(GOAL_SETTING), new Date("2027-01-03T23:59:59Z"));
  assert.equal(isPastGrace(GOAL_SETTING, new Date("2027-01-03T23:59:58Z")), false);
  assert.equal(isPastGrace(GOAL_SETTING, new Date("2027-01-04T00:00:00Z")), true);
});

test("§5.5 a 45-day grace window is refused — on a December deadline it lands past the cycle", () => {
  const base = {
    kind: "GOAL_SETTING",
    opensAt: "2026-12-01T00:00:00Z",
    deadline: "2026-12-31T00:00:00Z",
  };
  assert.equal(cycleStageSchema.safeParse({ ...base, graceDays: 45 }).success, false);
  assert.equal(cycleStageSchema.safeParse({ ...base, graceDays: -1 }).success, false);
  assert.equal(cycleStageSchema.safeParse({ ...base, graceDays: 3 }).success, true);
});

// --- §5.6 "by how long" -----------------------------------------------------

test("§5.6 overdue hours are floored, never rounded up", () => {
  assert.equal(hoursOverdue(GOAL_SETTING, GOAL_SETTING.deadline), 0, "on time is not overdue");
  const almostTwo = new Date(GOAL_SETTING.deadline.getTime() + 119 * 60 * 1000);
  assert.equal(
    hoursOverdue(GOAL_SETTING, almostTwo),
    1,
    "1h59m is one hour late — a compliance record nobody can argue with",
  );
  const exactlyTwo = new Date(GOAL_SETTING.deadline.getTime() + 2 * 60 * 60 * 1000);
  assert.equal(hoursOverdue(GOAL_SETTING, exactlyTwo), 2);
});

test("§5.6 a stage that is not yet overdue reports zero, not a negative", () => {
  assert.equal(hoursOverdue(GOAL_SETTING, new Date("2026-12-15T00:00:00Z")), 0);
});

// --- §8.3 C-Level exemption -------------------------------------------------

test("§8.3 C-Level skip goal-setting; every other track does not", () => {
  assert.equal(isGoalSettingExempt("C_LEVEL"), true);
  for (const track of ["DIRECTOR", "MANAGER", "LEAD", "INDIVIDUAL"] as const) {
    assert.equal(isGoalSettingExempt(track), false, `${track} sets goals`);
  }
});

// --- §4.1 who runs the cycle ------------------------------------------------

test("§4.1 both HR roles run the cycle; nobody else does", () => {
  assert.equal(canRunCycle(actor({ pmsRoles: ["HR_SUPER_ADMIN"] })), true);
  assert.equal(
    canRunCycle(actor({ pmsRoles: ["HRBP"] })),
    true,
    "§4.1 HRBP: 'Runs the cycle org-wide (approvals, 360 setup, deadlines, escalations)'",
  );
  assert.equal(
    canRunCycle(actor({ pmsRoles: ["EXECUTIVE_VIEWER"] })),
    false,
    "§4.1 COO / Ops Director: 'Nothing (read-only)'",
  );
  assert.equal(
    canRunCycle(actor({ isLineManager: true })),
    false,
    "a line manager acts on their reports, not on the year",
  );
  assert.equal(canRunCycle(actor({ employeeId: null })), false, "and an unlinked actor on nothing");
});
