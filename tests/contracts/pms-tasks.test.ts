import test from "node:test";
import assert from "node:assert/strict";

import {
  CLOCK_TICK_MS,
  DUE_SOON_MS,
  STAGE_RANK,
  buildTasks,
  ownTask,
  reportTask,
  toneForStage,
} from "../../lib/pms/tasks";
import { buildThreeSixtyTasks, type ThreeSixtyTaskRow } from "../../lib/pms/tasks";
import { buildYearEndTasks, type YearEndTaskState } from "../../lib/pms/tasks";
import type { ParticipantRow } from "../../components/pms/ParticipantList";
import type { GoalStage } from "../../components/pms/StageBanner";

/**
 * §4.4's "My Tasks" — whose turn it is, and in what order.
 *
 * The module's own header says it lives in `lib/` because this is "exactly the
 * logic a test can check and a screenshot cannot". It shipped without one; this
 * is that test. The ordering assertions are the point: a task list is read and
 * acted on top-down, so the row that leads it is a product decision, not an
 * incidental property of an integer.
 */

const ME = "me";

function row(over: Partial<ParticipantRow> & { id?: string } = {}): ParticipantRow {
  const { id = "p1", ...rest } = over;
  return {
    participantId: id,
    employee: {
      id: "someone",
      name: "Someone Else",
      email: "someone@rihal.example",
      roleTrack: "INDIVIDUAL",
      status: "ACTIVE",
      managerId: null,
      department: null,
      entity: null,
    },
    kpiCount: 0,
    weightageTotal: "0",
    weightageComplete: false,
    weightageMessage: null,
    signOff: { employeeSignedAt: null, managerSignedAt: null, bothSigned: false },
    goalsApprovedAt: null,
    goalSettingExempt: false,
    editBlockedReason: null,
    ...rest,
  } as ParticipantRow;
}

const mine = (over: Partial<ParticipantRow> & { id?: string } = {}) =>
  row({ ...over, employee: { ...row().employee, id: ME, name: "Me", ...(over.employee ?? {}) } });

const myReport = (over: Partial<ParticipantRow> & { id?: string } = {}) =>
  row({ ...over, employee: { ...row().employee, managerId: ME, ...(over.employee ?? {}) } });

const build = (rows: ParticipantRow[], stageRank = STAGE_RANK.open) =>
  buildTasks({
    rows,
    employeeId: ME,
    stageRank,
    hrefFor: (r) => `/x/${r.participantId}`,
    locale: "en",
  });

// --- §4.4 assignment, never role ---------------------------------------------

test("§4.4 a row that is neither mine nor my report produces no task", () => {
  assert.deepEqual(build([row()]), []);
});

test("§4.4 an actor with no employee row has no tasks at all", () => {
  const tasks = buildTasks({
    rows: [mine(), myReport()],
    employeeId: null,
    stageRank: STAGE_RANK.open,
    hrefFor: () => "/x",
    locale: "en",
  });
  assert.deepEqual(tasks, [], "assignment is the only key — an unlinked actor is assigned nothing");
});

test("§8.3 a C-Level participant produces no goal-setting task, mine or my report's", () => {
  assert.deepEqual(build([mine({ goalSettingExempt: true })]), []);
  assert.deepEqual(build([myReport({ goalSettingExempt: true })]), []);
});

test("a person who is both my report and myself gets both cards", () => {
  // Only reachable if someone is their own manager, but the two checks are
  // independent by design and neither should swallow the other.
  const self = row({ employee: { ...row().employee, id: ME, managerId: ME } });
  const keys = build([self]).map((t) => t.key);
  assert.deepEqual(keys.sort(), ["own-p1", "report-p1"]);
});

// --- §5.1 a finished step is not a task --------------------------------------

test("§5.1 my own set drops off the list once I have signed", () => {
  assert.equal(
    ownTask(
      mine({
        signOff: {
          employeeSignedAt: "2026-12-02T00:00:00Z",
          managerSignedAt: null,
          bothSigned: false,
        },
      }),
      "/x",
      0,
    ),
    null,
  );
});

test("§5.1 a report drops off once it is at 100% and I have signed it", () => {
  const done = myReport({
    kpiCount: 3,
    weightageComplete: true,
    signOff: { employeeSignedAt: null, managerSignedAt: "2026-12-02T00:00:00Z", bothSigned: false },
  });
  assert.equal(reportTask(done, "/x", 0), null, "the employee's signature is not my task");
});

// --- the ordering, which is the whole reason this is a module ----------------

test("the most actionable task leads, and the one nobody can act on trails", () => {
  const rows = [
    // Nothing for me to do: my manager has not drafted my set yet.
    mine({ id: "own-waiting" }),
    // Mine, at 100%, waiting on my signature.
    myReport({ id: "sign-report", kpiCount: 3, weightageComplete: true }),
    // A report with nothing drafted at all — blocks that person entirely.
    myReport({ id: "empty-report" }),
    // A report part-way drafted.
    myReport({ id: "partial-report", kpiCount: 2 }),
  ];
  assert.deepEqual(
    build(rows).map((t) => t.key),
    ["report-empty-report", "report-partial-report", "report-sign-report", "own-own-waiting"],
  );
});

test("my own signable set outranks the informational card but not my reports' work", () => {
  const rows = [mine({ id: "s", kpiCount: 3, weightageComplete: true }), myReport({ id: "r" })];
  assert.deepEqual(
    build(rows).map((t) => t.key),
    ["report-r", "own-s"],
  );
});

test("stage urgency dominates task kind — an overdue stage outranks everything open", () => {
  const overdue = build(
    [mine({ id: "o", kpiCount: 3, weightageComplete: true })],
    STAGE_RANK.overdue,
  );
  const open = build([myReport({ id: "r" })], STAGE_RANK.open);
  assert.ok(
    overdue[0].rank < open[0].rank,
    `an overdue own-set (${overdue[0].rank}) must outrank an open report (${open[0].rank})`,
  );
});

test("ties break deterministically, so the list does not reshuffle between renders", () => {
  const a = build([myReport({ id: "b" }), myReport({ id: "a" })]).map((t) => t.key);
  const b = build([myReport({ id: "a" }), myReport({ id: "b" })]).map((t) => t.key);
  assert.deepEqual(a, b);
  assert.deepEqual(a, ["report-a", "report-b"]);
});

// --- what each card says ------------------------------------------------------

test("§5.3 an unsignable own set offers a view, not a sign button the route would refuse", () => {
  const t = ownTask(mine(), "/x", 0)!;
  assert.equal(t.detailKey, "ownSetWaiting");
  assert.equal(t.actionKey, "ownSetView");

  const signable = ownTask(mine({ kpiCount: 3, weightageComplete: true }), "/x", 0)!;
  assert.equal(signable.detailKey, "ownSetSign");
  assert.equal(signable.actionKey, "ownSetAction");
});

test("a report with zero KPIs reads differently from one that is merely short", () => {
  assert.equal(reportTask(myReport(), "/x", 0)!.detailKey, "reportDraftEmpty");
  assert.equal(reportTask(myReport({ kpiCount: 2 }), "/x", 0)!.detailKey, "reportDraft");
  assert.equal(
    reportTask(myReport({ kpiCount: 3, weightageComplete: true }), "/x", 0)!.detailKey,
    "reportSign",
  );
});

test("§5.4 the server's refusal sentence is carried verbatim, never re-worded", () => {
  const reason = "The goal-setting deadline has passed and the stage is locked (§5.4).";
  assert.equal(reportTask(myReport({ editBlockedReason: reason }), "/x", 0)!.blockedReason, reason);
  assert.equal(
    ownTask(mine({ editBlockedReason: reason }), "/x", 0)!.blockedReason,
    null,
    "my own card has no edit gate",
  );
});

// --- the tone bands -----------------------------------------------------------

const stage = (over: Partial<GoalStage> = {}): GoalStage =>
  ({ state: "OPEN", deadline: "2026-12-31T23:59:59Z", ...over }) as GoalStage;

test("§5.4 the LOCK comes from the server's state, never from the client clock", () => {
  // A client clock hours behind must not be able to un-lock a locked stage.
  assert.equal(
    toneForStage(stage({ state: "LOCKED" }), new Date("2020-01-01").getTime()),
    "overdue",
  );
  assert.equal(toneForStage(stage({ state: "NOT_YET_OPEN" }), Date.now()), "notYetOpen");
});

test("the due-soon band opens exactly three days out, and not before", () => {
  const deadline = new Date("2026-12-31T23:59:59Z").getTime();
  assert.equal(toneForStage(stage(), deadline - DUE_SOON_MS - 1), "open");
  assert.equal(toneForStage(stage(), deadline - DUE_SOON_MS), "dueSoon");
  assert.equal(toneForStage(stage(), deadline), "dueSoon");
});

test("before the clock has been read, the tone is the quiet one", () => {
  // `nowMs` is null until the client subscription fires; a null must never be
  // treated as 0 and render every open stage as overdue.
  assert.equal(toneForStage(stage(), null), "open");
  assert.equal(toneForStage(null, null), "notYetOpen");
});

test("the ranks order the bands the way a person would read them", () => {
  assert.deepEqual(
    (["overdue", "dueSoon", "open", "notYetOpen"] as const).map((t) => STAGE_RANK[t]),
    [0, 1, 2, 3],
  );
  assert.equal(CLOCK_TICK_MS, 60_000, "the due-soon band re-evaluates every minute");
});

// --- §4.4's missing category: 360 assignments ---------------------------------

const threeSixtyRow = (over: Partial<ThreeSixtyTaskRow> = {}): ThreeSixtyTaskRow => ({
  id: "a1",
  status: "NOT_STARTED",
  ratee: { id: "e1", name: "Noura Al-Siyabi" },
  deadline: "2027-06-30T00:00:00.000Z",
  ...over,
});

test("§4.4 a 360 assigned to me becomes a task, named for the person I assess", () => {
  const tasks = buildThreeSixtyTasks({
    assignments: [threeSixtyRow()],
    hrefFor: (a) => `/en/three-sixty/assignments/${a.id}`,
    nowMs: new Date("2027-01-01").getTime(),
  });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].titleKey, "threeSixtyTitle");
  assert.equal(tasks[0].titleParams?.name, "Noura Al-Siyabi");
  assert.equal(tasks[0].href, "/en/three-sixty/assignments/a1");
});

test("§9.7 a SUBMITTED assignment produces no task — submission is one-way", () => {
  const tasks = buildThreeSixtyTasks({
    assignments: [threeSixtyRow({ status: "SUBMITTED" })],
    hrefFor: (a) => `/x/${a.id}`,
    nowMs: new Date("2027-01-01").getTime(),
  });
  assert.deepEqual(tasks, [], "a task nobody can act on is not a task");
});

test("a started 360 says resume rather than start", () => {
  const [task] = buildThreeSixtyTasks({
    assignments: [threeSixtyRow({ status: "IN_PROGRESS" })],
    hrefFor: (a) => `/x/${a.id}`,
    nowMs: new Date("2027-01-01").getTime(),
  });
  assert.equal(task.detailKey, "threeSixtyResume");
  assert.equal(task.actionKey, "threeSixtyResumeAction");
});

test("a 360 task carries its OWN deadline, not the goal-setting stage's", () => {
  // The bug this pins: My Tasks rendered one stage-wide badge per row, so a 360
  // due in a month showed as "Deadline passed" because goal-setting had closed.
  const [task] = buildThreeSixtyTasks({
    assignments: [threeSixtyRow()],
    hrefFor: (a) => `/x/${a.id}`,
    nowMs: new Date("2027-01-01").getTime(),
  });
  assert.equal(task.dueAt, "2027-06-30T00:00:00.000Z");
  assert.equal(task.tone, "open");
});

test("§9.7 an overdue assignment ranks above everything still open", () => {
  const [overdue] = buildThreeSixtyTasks({
    assignments: [threeSixtyRow({ status: "OVERDUE" })],
    hrefFor: (a) => `/x/${a.id}`,
    nowMs: new Date("2027-07-01").getTime(),
  });
  const [open] = buildThreeSixtyTasks({
    assignments: [threeSixtyRow()],
    hrefFor: (a) => `/x/${a.id}`,
    nowMs: new Date("2027-01-01").getTime(),
  });
  assert.ok(overdue.rank < open.rank, "urgency sorts first");
});

// --- §7.1 the employee's own year-end card ----------------------------------
//
// UAT Scenario D. The nav comment and the /year-end refusal copy both told the
// employee their assessment "reaches them through My Tasks"; My Tasks built
// goal-setting and 360 cards only, so §7.1's FIRST step had no door anywhere.
// These cases pin both halves: it must appear when it is genuinely their move,
// and stay silent when it is not — a task nobody can act on is not a prompt,
// it is a standing accusation.

const OPEN_WINDOW: YearEndTaskState = {
  participant: { id: "p1" },
  stage: { deadline: "2027-11-30T00:00:00Z", state: "OPEN" },
  kpis: [{ id: "k1" }, { id: "k2" }],
  state: { kpiCount: 2, employeeRated: 0 },
  signedParties: [],
  goalSettingExempt: false,
  blockedReason: null,
};
const NOV_1 = new Date("2027-11-01T00:00:00Z").getTime();
const yearEnd = (over: Partial<YearEndTaskState> = {}, nowMs: number | null = NOV_1) =>
  buildYearEndTasks({ mine: { ...OPEN_WINDOW, ...over }, href: "/en/year-end", nowMs });

test("§7.1 an open window with nothing rated yet IS a task", () => {
  const [task] = yearEnd();
  assert.ok(task, "the employee's own assessment must reach My Tasks");
  assert.equal(task.href, "/en/year-end");
  assert.equal(task.detailKey, "yearEndSelfStart");
  assert.deepEqual(task.detailParams, { rated: 0, total: 2 });
});

test("§7.1 a part-finished assessment says finish, not start", () => {
  // "Start" on a set someone is half-way through reads as lost work.
  const [task] = yearEnd({ state: { kpiCount: 2, employeeRated: 1 } });
  assert.equal(task.detailKey, "yearEndSelfResume");
  assert.equal(task.actionKey, "yearEndSelfResumeAction");
  assert.deepEqual(task.detailParams, { rated: 1, total: 2 });
});

test("§8.3 C-Level get no self-assessment card at all", () => {
  // Categorical: they skip self-assessment entirely, so a card would be a
  // prompt to do something the API refuses outright.
  assert.deepEqual(yearEnd({ goalSettingExempt: true }), []);
});

test("§7.1 a signed assessment is finished — the next move is the manager's", () => {
  assert.deepEqual(yearEnd({ signedParties: ["EMPLOYEE"] }), []);
});

test("§5.4 a window that has not opened yet is nobody's move", () => {
  assert.deepEqual(
    yearEnd({ stage: { deadline: "2027-11-30T00:00:00Z", state: "NOT_YET_OPEN" } }),
    [],
  );
});

test("§5.4 a LOCKED window still shows, and shows as overdue", () => {
  // The deadline passing does not mean the work stopped mattering — §5.5's
  // ladder is already escalating it, and hiding the card hides the reason.
  const [task] = yearEnd({ stage: { deadline: "2027-11-30T00:00:00Z", state: "LOCKED" } });
  assert.ok(task);
  assert.equal(task.tone, "overdue");
  assert.equal(task.rank, STAGE_RANK.overdue);
});

test("§3.5 someone not enrolled, and someone with no KPIs, get no card", () => {
  assert.deepEqual(yearEnd({ participant: null }), []);
  assert.deepEqual(yearEnd({ kpis: [], state: { kpiCount: 0, employeeRated: 0 } }), []);
  assert.deepEqual(buildYearEndTasks({ mine: null, href: "/en/year-end", nowMs: NOV_1 }), []);
});

test("§5.1 the server's refusal travels with the card, not just to the screen", () => {
  // A set with no HR-approved baseline cannot be rated. The card still appears
  // — it is still their year — but it carries the reason, so nobody clicks
  // through to discover it.
  const reason = "This KPI set has no HR-approved baseline, so there is nothing to assess (§5.1).";
  const [task] = yearEnd({ blockedReason: reason });
  assert.equal(task.blockedReason, reason);
});

test("a deadline inside the due-soon window raises the card's urgency", () => {
  const justBefore = new Date("2027-11-30T00:00:00Z").getTime() - DUE_SOON_MS / 2;
  const [task] = yearEnd({}, justBefore);
  assert.equal(task.tone, "dueSoon");
});
