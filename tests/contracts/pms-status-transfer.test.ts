import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "../../generated/prisma/client";

import {
  completion,
  deriveStatus,
  emptyTally,
  goalSettingState,
  outstandingLabel,
  stageProgress,
  tallyBy,
  yearEndState,
  type ParticipantStatusInput,
} from "../../lib/pms/status";
import {
  clampToService,
  periodAuthorityBlockedReason,
  periodDays,
  periodWeight,
  periodWeightageBlockedReason,
  proratedComponent,
  splitWindows,
} from "../../lib/pms/transfer";
import { weightageMessageByPeriod } from "../../lib/pms/kpi";
import { BAND_RANGE, displayScore } from "../../lib/pms/scoring";
import {
  canResolveRollUp,
  managerChangeInvalidatesSignatures,
  rollUpTarget,
} from "../../lib/pms/roll-up";
import { consolidateThreeSixty } from "../../lib/pms/three-sixty";
import type { PmsActor } from "../../lib/pms/permissions";

/** §12 edge cases and §13's status engine. */

const d = (v: string | number) => new Prisma.Decimal(v);

function participant(over: Partial<ParticipantStatusInput> = {}): ParticipantStatusInput {
  return {
    participantId: "p1",
    employeeId: "e1",
    name: "Layla",
    employeeNumber: "1001",
    managerId: "m1",
    managerName: "Sami",
    department: "Delivery",
    entity: "Rihal",
    goalSettingExempt: false,
    kpiCount: 3,
    weightageTotal: d(100),
    goalsApprovedAt: null,
    goalSetting: { employeeSignedAt: null, managerSignedAt: null },
    yearEnd: { employeeSignedAt: null, managerSignedAt: null },
    selfRatedCount: 0,
    managerRatedCount: 0,
    band: null,
    score: null,
    ...over,
  };
}

// --- §13.4's status engine -------------------------------------------------

test("§5.1: HR approval is terminal — an approved set is COMPLETE however it got there", () => {
  // §5.4's "Employee did not sign" path reaches approval with one signature
  // missing, so approval has to be checked before the signatures.
  const row = participant({
    goalsApprovedAt: new Date("2026-12-20"),
    goalSetting: { employeeSignedAt: null, managerSignedAt: new Date("2026-12-15") },
  });
  assert.equal(goalSettingState(row), "COMPLETE");
});

test("§5.1: the goal-setting order is draft → manager → employee → HR", () => {
  assert.equal(goalSettingState(participant({ kpiCount: 0 })), "NOT_STARTED");
  assert.equal(goalSettingState(participant({ weightageTotal: d("99.99") })), "IN_PROGRESS");
  assert.equal(goalSettingState(participant()), "AWAITING_MANAGER");
  assert.equal(
    goalSettingState(
      participant({ goalSetting: { employeeSignedAt: null, managerSignedAt: new Date() } }),
    ),
    "AWAITING_EMPLOYEE",
  );
  assert.equal(
    goalSettingState(
      participant({
        goalSetting: { employeeSignedAt: new Date(), managerSignedAt: new Date() },
      }),
    ),
    "AWAITING_HR",
  );
});

test("§8.3: a C-Level participant has no goal-setting step at all", () => {
  assert.equal(goalSettingState(participant({ goalSettingExempt: true })), "NOT_APPLICABLE");
  assert.equal(yearEndState(participant({ goalSettingExempt: true })), "NOT_APPLICABLE");
});

test("§7.1: year-end runs self-assess → manager review → both sign", () => {
  const approved = { goalsApprovedAt: new Date("2026-12-20") };
  assert.equal(yearEndState(participant({ ...approved })), "NOT_STARTED");
  assert.equal(yearEndState(participant({ ...approved, selfRatedCount: 1 })), "IN_PROGRESS");
  assert.equal(yearEndState(participant({ ...approved, selfRatedCount: 3 })), "AWAITING_MANAGER");
  assert.equal(
    yearEndState(participant({ ...approved, selfRatedCount: 3, managerRatedCount: 3 })),
    "AWAITING_EMPLOYEE",
  );
  assert.equal(
    yearEndState(
      participant({
        ...approved,
        selfRatedCount: 3,
        managerRatedCount: 3,
        yearEnd: { employeeSignedAt: new Date(), managerSignedAt: new Date() },
      }),
    ),
    "COMPLETE",
  );
});

test("Appendix A: an unapproved baseline makes year-end NOT_APPLICABLE, not 'not started'", () => {
  // "An employee is never disadvantaged by a manager's inaction" — there is
  // nothing to assess against, so the row must not read as the employee's fault.
  assert.equal(
    yearEndState(participant({ goalsApprovedAt: null, selfRatedCount: 0 })),
    "NOT_APPLICABLE",
  );
});

test("§5.4: a locked stage yields the spec's own two status strings", () => {
  const neither = participant();
  assert.equal(outstandingLabel(neither, true), "managerDidNotSign");
  const managerOnly = participant({
    goalSetting: { employeeSignedAt: null, managerSignedAt: new Date() },
  });
  assert.equal(outstandingLabel(managerOnly, true), "employeeDidNotSign");
  // Nothing outstanding while the stage is still open.
  assert.equal(outstandingLabel(neither, false), null);
  // Nor once HR has approved.
  assert.equal(outstandingLabel(participant({ goalsApprovedAt: new Date() }), true), null);
});

test("completion excludes NOT_APPLICABLE from the denominator rather than counting it done", () => {
  const tally = emptyTally();
  tally.NOT_APPLICABLE = 7;
  tally.COMPLETE = 3;
  tally.AWAITING_MANAGER = 1;
  const result = completion(tally);
  assert.equal(result.total, 4, "the seven exempt participants are not work");
  assert.equal(result.done, 3);
  assert.equal(result.percent, 75);
});

test("an empty tally reports 0% rather than dividing by zero", () => {
  assert.deepEqual(completion(emptyTally()), { done: 0, total: 0, percent: 0 });
});

test("stageProgress reports both stages, and tallyBy keys on the derived state", () => {
  const rows = [
    deriveStatus(participant({ participantId: "a", goalsApprovedAt: new Date() }), false),
    deriveStatus(participant({ participantId: "b", kpiCount: 0 }), false),
  ];
  const progress = stageProgress(rows);
  assert.deepEqual(
    progress.map((p) => p.stageKind),
    ["GOAL_SETTING", "YEAR_END"],
  );
  const goal = tallyBy(rows, (r) => r.goalSettingState);
  assert.equal(goal.COMPLETE, 1);
  assert.equal(goal.NOT_STARTED, 1);
});

// --- §13.1's displayScore --------------------------------------------------

test("§13.1: an uncalibrated employee sees their exact score", () => {
  assert.equal(displayScore(d("3.96"), "TARGET").toString(), "3.96");
});

test("§13.1: a moved band clamps the score so the card carries no sign of calibration", () => {
  // 3.80 is Target by §8.7. Moved to Excellent, showing 3.80 next to "Excellent"
  // would tell the employee a curve exists.
  assert.equal(displayScore(d("3.80"), "EXCELLENT").toString(), "4");
  // Downward too.
  assert.equal(displayScore(d("4.60"), "TARGET").toString(), "3.99");
});

test("§8.7: every band range agrees with bandFor at both ends", async () => {
  const { bandFor } = await import("../../lib/pms/scoring");
  for (const [band, range] of Object.entries(BAND_RANGE)) {
    assert.equal(bandFor(range.min), band, `${band} min`);
    assert.equal(bandFor(range.max), band, `${band} max`);
  }
});

// --- §13.1's 360 consolidation ---------------------------------------------

test("§13.1: comments come back flat and sorted, with no rater or form grouping", () => {
  const result = consolidateThreeSixty([
    {
      responses: [
        { questionId: "q1", score: 4, text: "zeta" },
        { questionId: "q2", score: 4, text: null },
      ],
      questions: [
        { id: "q1", scored: true },
        { id: "q2", scored: true },
      ],
    },
    {
      responses: [{ questionId: "q1", score: 2, text: "alpha" }],
      questions: [{ id: "q1", scored: true }],
    },
  ]);
  assert.deepEqual(result.comments, ["alpha", "zeta"], "sorted, so order leaks nothing");
  // §9.5 per-form ratio, averaged: (8/8 = 1.00) and (2/4 = 0.50) → 0.75 → ×5.
  assert.equal(result.level?.toFixed(2), "3.75");
});

test("§13.1: blank comment text never becomes an empty entry", () => {
  const result = consolidateThreeSixty([
    {
      responses: [{ questionId: "q1", score: 3, text: "   " }],
      questions: [{ id: "q1", scored: true }],
    },
  ]);
  assert.deepEqual(result.comments, []);
});

test("no scored form yields a null level rather than zero", () => {
  const result = consolidateThreeSixty([
    { responses: [{ questionId: "q1", score: null, text: "words" }], questions: [] },
    { responses: [{ questionId: "q1", score: null, text: null }], questions: [] },
  ]);
  assert.equal(result.level, null);
  assert.deepEqual(result.comments, ["words"], "an unscored form still carries its text");
});

// --- §13.1's anonymity floor (red-team R3, operator decision 2026-08-26) ----

test("§13.1: ONE submitted form's comments are withheld, not published", () => {
  // §9.4 fixes the rater set at exactly three and names the line manager as one
  // of them, so the ratee knows the pool. A single comment in that pool is
  // attributable by elimination — pooling it is not consolidation.
  const result = consolidateThreeSixty([
    {
      responses: [{ questionId: "q1", score: 4, text: "works well under pressure" }],
      questions: [{ id: "q1", scored: true }],
    },
  ]);
  assert.deepEqual(result.comments, [], "nothing reaches the employee");
  assert.equal(result.commentsWithheld, true, "and the caller is TOLD it was withheld");
  assert.equal(result.submittedForms, 1);
  // The SCORE is unaffected: §9.5 averages what came back, and HR sees the rater
  // count at calibration. Withholding a figure the formula already used would
  // read as data hidden from the employee, not as protection for a colleague.
  assert.equal(result.level?.toFixed(2), "5.00");
});

test("§13.1: TWO submitted forms clear the floor", () => {
  const result = consolidateThreeSixty([
    {
      responses: [{ questionId: "q1", score: 4, text: "clear communicator" }],
      questions: [{ id: "q1", scored: true }],
    },
    {
      responses: [{ questionId: "q1", score: 3, text: null }],
      questions: [{ id: "q1", scored: true }],
    },
  ]);
  assert.deepEqual(result.comments, ["clear communicator"]);
  assert.equal(result.commentsWithheld, false);
  assert.equal(result.submittedForms, 2);
});

test("§13.1: a lone form with NO comments is empty, never 'withheld'", () => {
  // The two are different facts. Telling an employee feedback is being held back
  // when nobody wrote any would be a lie they could act on.
  const result = consolidateThreeSixty([
    {
      responses: [{ questionId: "q1", score: 4, text: "  " }],
      questions: [{ id: "q1", scored: true }],
    },
  ]);
  assert.deepEqual(result.comments, []);
  assert.equal(result.commentsWithheld, false);
});

// --- §12.3's transfer split ------------------------------------------------

test("§12.3: the transfer date belongs to the NEW period, so no day is counted twice", () => {
  const windows = splitWindows({
    cycleStart: new Date(Date.UTC(2027, 0, 1)),
    cycleEnd: new Date(Date.UTC(2027, 11, 31)),
    transferDate: new Date(Date.UTC(2027, 6, 1)),
  });
  assert.ok(windows);
  assert.equal(windows.before.endsOn.toISOString().slice(0, 10), "2027-06-30");
  assert.equal(windows.after.startsOn.toISOString().slice(0, 10), "2027-07-01");
  assert.equal(periodDays(windows.before) + periodDays(windows.after), 365);
});

test("§12.3: a date outside the cycle is not a split", () => {
  const cycle = {
    cycleStart: new Date(Date.UTC(2027, 0, 1)),
    cycleEnd: new Date(Date.UTC(2027, 11, 31)),
  };
  assert.equal(splitWindows({ ...cycle, transferDate: new Date(Date.UTC(2026, 11, 31)) }), null);
  assert.equal(splitWindows({ ...cycle, transferDate: new Date(Date.UTC(2028, 0, 1)) }), null);
  // The first day of the cycle is a starting position, not a transfer.
  assert.equal(splitWindows({ ...cycle, transferDate: new Date(Date.UTC(2027, 0, 1)) }), null);
});

test("§12.3: weights are days ÷ 365 and sum to 1 across a full year", () => {
  const windows = splitWindows({
    cycleStart: new Date(Date.UTC(2027, 0, 1)),
    cycleEnd: new Date(Date.UTC(2027, 11, 31)),
    transferDate: new Date(Date.UTC(2027, 6, 1)),
  })!;
  const total = periodWeight(windows.before).plus(periodWeight(windows.after));
  assert.equal(total.toFixed(4), "1.0000");
});

test("§12.3: the worked formula — (old × old days/365) + (new × new days/365)", () => {
  const windows = splitWindows({
    cycleStart: new Date(Date.UTC(2027, 0, 1)),
    cycleEnd: new Date(Date.UTC(2027, 11, 31)),
    transferDate: new Date(Date.UTC(2027, 6, 1)),
  })!;
  // 181 days at 4.00, 184 days at 3.00.
  const result = proratedComponent([
    { ...windows.before, score: d(4) },
    { ...windows.after, score: d(3) },
  ]);
  const expected = d(4)
    .times(d(181).div(365))
    .plus(d(3).times(d(184).div(365)));
  assert.equal(result?.toFixed(6), expected.toFixed(6));
  assert.equal(result?.toFixed(2), "3.50");
});

test("§12.3: an unassessed period makes the whole component null, never half a score", () => {
  const windows = splitWindows({
    cycleStart: new Date(Date.UTC(2027, 0, 1)),
    cycleEnd: new Date(Date.UTC(2027, 11, 31)),
    transferDate: new Date(Date.UTC(2027, 6, 1)),
  })!;
  assert.equal(
    proratedComponent([
      { ...windows.before, score: d(4) },
      { ...windows.after, score: null },
    ]),
    null,
  );
});

test("§12.3: weights sum to LESS than 1 for a leaver, pro-rating the score down", () => {
  // A leaver's periods do not cover the year; §12.3's 365 denominator is what
  // makes that pro-rate rather than normalise away.
  const half = {
    startsOn: new Date(Date.UTC(2027, 0, 1)),
    endsOn: new Date(Date.UTC(2027, 5, 30)),
  };
  assert.ok(periodWeight(half).lessThan(1));
  assert.equal(proratedComponent([{ ...half, score: d(4) }])?.toFixed(2), "1.98");
});

test("§5.3 + §12.3: each period needs its own 100%", () => {
  assert.equal(periodWeightageBlockedReason({ orderIndex: 0, weightageTotal: d(100) }), null);
  const short = periodWeightageBlockedReason({ orderIndex: 1, weightageTotal: d(60) });
  assert.match(short ?? "", /period 2/);
  assert.match(short ?? "", /60\.00%/);
});

test("§12.3: weightageMessageByPeriod checks each portion, and is unchanged when unsplit", () => {
  const unsplit = [{ weightage: d(60) }, { weightage: d(40) }];
  assert.equal(weightageMessageByPeriod(unsplit), null);

  const split = [
    { weightage: d(60), assignmentPeriodId: "p1" },
    { weightage: d(40), assignmentPeriodId: "p1" },
    { weightage: d(100), assignmentPeriodId: "p2" },
  ];
  assert.equal(weightageMessageByPeriod(split), null, "each period at 100");

  const summingTo100Across = [
    { weightage: d(50), assignmentPeriodId: "p1" },
    { weightage: d(50), assignmentPeriodId: "p2" },
  ];
  assert.ok(
    weightageMessageByPeriod(summingTo100Across),
    "two halves summing to 100 across periods is NOT signable — §12.3 decouples the managers",
  );
});

test("§12.3: the period's own manager owns their portion, and HR overrides", () => {
  const period = { orderIndex: 0, managerEmployeeId: "old-manager" };
  assert.equal(
    periodAuthorityBlockedReason({ actorEmployeeId: "old-manager", actorIsHr: false, period }),
    null,
  );
  // The NEW manager, who now holds the live relationship, does not own the old half.
  assert.match(
    periodAuthorityBlockedReason({ actorEmployeeId: "new-manager", actorIsHr: false, period }) ??
      "",
    /period 1/i,
  );
  assert.equal(
    periodAuthorityBlockedReason({ actorEmployeeId: "anyone", actorIsHr: true, period }),
    null,
    "§12.3 — HR signs off / consolidates",
  );
});

// --- §12.1 / §12.2's roll-up ------------------------------------------------

test("§12.1: the roll-up goes exactly ONE level up", () => {
  assert.equal(rollUpTarget({ managerId: "grandparent" }), "grandparent");
  // Top of tree: null, which is the case HR most needs to see.
  assert.equal(rollUpTarget({ managerId: null }), null);
});

test("§12.2: both HR roles may name a permanent manager", () => {
  const actor = (roles: string[]): PmsActor =>
    ({
      employeeId: "hr1",
      pmsRoles: roles,
      isLineManager: false,
    }) as unknown as PmsActor;
  assert.equal(canResolveRollUp(actor(["HR_SUPER_ADMIN"])), true);
  assert.equal(
    canResolveRollUp(actor(["HRBP"])),
    true,
    "§10.6's carve-out is calibration, not the org chart",
  );
  assert.equal(canResolveRollUp(actor([])), false);
  assert.equal(canResolveRollUp(actor(["EXECUTIVE_VIEWER"])), false);
});

test("§12.2: a manager change never invalidates a signature", () => {
  assert.equal(managerChangeInvalidatesSignatures(), false);
});

// --- the split-year leaver, found by the post-push breadth review ------------

test("§12.3 + §11.4: a leaver's split periods are clamped to their last working day", () => {
  const windows = splitWindows({
    cycleStart: new Date(Date.UTC(2026, 0, 1)),
    cycleEnd: new Date(Date.UTC(2026, 11, 31)),
    transferDate: new Date(Date.UTC(2026, 6, 1)),
  })!;
  const service = {
    dateOfJoining: new Date(Date.UTC(2020, 0, 1)),
    lastWorkingDay: new Date(Date.UTC(2026, 7, 31)),
  };

  const before = clampToService(windows.before, service);
  const after = clampToService(windows.after, service);

  // The old half is untouched — they worked all of it.
  assert.equal(periodDays(before), 181);
  // The new half stops at the last working day, not at 31 December.
  assert.equal(after.endsOn.toISOString().slice(0, 10), "2026-08-31");
  assert.equal(periodDays(after), 62);

  // The whole point: the weights must NOT sum to 1 for someone who left in
  // August. Before the fix they did, so the band came from a full year while
  // §11.4 pro-rated the bonus to the days actually worked — the score and the
  // payslip disagreeing about one person's calendar.
  const total = periodWeight(before).plus(periodWeight(after));
  assert.ok(total.lessThan(1), `weights must be short of a full year, got ${total.toFixed(4)}`);
  assert.equal(total.toFixed(4), (243 / 365).toFixed(4));
});

test("§12.3 + §11.2: a mid-year joiner's first period is clamped at the other end too", () => {
  const windows = splitWindows({
    cycleStart: new Date(Date.UTC(2026, 0, 1)),
    cycleEnd: new Date(Date.UTC(2026, 11, 31)),
    transferDate: new Date(Date.UTC(2026, 8, 1)),
  })!;
  const clamped = clampToService(windows.before, {
    dateOfJoining: new Date(Date.UTC(2026, 2, 1)),
    lastWorkingDay: null,
  });
  assert.equal(clamped.startsOn.toISOString().slice(0, 10), "2026-03-01");
  assert.ok(periodDays(clamped) < periodDays(windows.before));
});

test("a period entirely outside the service window is zero days, not a negative one", () => {
  // A leaver whose departure predates the transfer: period 2 collapses rather
  // than contributing a negative weight to the score.
  const window = {
    startsOn: new Date(Date.UTC(2026, 6, 1)),
    endsOn: new Date(Date.UTC(2026, 11, 31)),
  };
  const clamped = clampToService(window, {
    dateOfJoining: null,
    lastWorkingDay: new Date(Date.UTC(2026, 2, 31)),
  });
  assert.equal(periodDays(clamped), 0);
  assert.equal(periodWeight(clamped).toFixed(4), "0.0000");
});
