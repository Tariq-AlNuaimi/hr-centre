import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "../../generated/prisma/client";

import {
  evaluatorStatus,
  isReminderDue,
  THREE_SIXTY_REMINDER_DAYS,
  ANSWER_SCALE,
  MAX_ANSWER,
  RATERS_PER_EMPLOYEE,
  activationBlockedReason,
  formRatio,
  isAnswerScore,
  isThreeSixtyExempt,
  overallRatio,
  proposeRaters,
  templateTypeFor,
  type RaterCandidate,
} from "../../lib/pms/three-sixty";
import { answerBlockedReason } from "../../lib/pms/three-sixty-answer";

/**
 * §9 — the 360 module. Where the spec gives a worked example, that example is
 * the assertion.
 */

const person = (id: string, over: Partial<RaterCandidate> = {}): RaterCandidate => ({
  id,
  managerId: "mgr",
  roleTrack: "INDIVIDUAL",
  departmentId: "d1",
  status: "ACTIVE",
  ...over,
});

// --- §9.3's forced scale ---------------------------------------------------------

test("§9.3 the scale is 1-4 with no neutral midpoint", () => {
  assert.equal(MAX_ANSWER, 4);
  assert.deepEqual(
    ANSWER_SCALE.map((a) => a.score),
    [1, 2, 3, 4],
  );
  // Four points cannot have a middle — that is the entire point of a forced scale.
  assert.equal(ANSWER_SCALE.length % 2, 0);
});

test("§9.3 anything off the scale is refused — 5 especially", () => {
  for (const s of [1, 2, 3, 4]) assert.equal(isAnswerScore(s), true);
  // 5 is §8.1's KPI scale. Accepting it here would inflate every §9.5 ratio.
  for (const s of [0, 5, 6, 2.5, NaN]) assert.equal(isAnswerScore(s), false, `${s}`);
});

// --- §9.2's three templates, chosen by relationship --------------------------------

test("§9.2 the template follows the DIRECTION of the relationship", () => {
  const mgr = person("mgr", { managerId: "boss" });
  const emp = person("emp", { managerId: "mgr" });

  assert.equal(templateTypeFor({ rater: mgr, ratee: emp }), "LINE_MANAGER_TO_EMPLOYEE");
  // "a reportee assessing their manager uses this template; employee = reportee"
  assert.equal(templateTypeFor({ rater: emp, ratee: mgr }), "EMPLOYEE_TO_LINE_MANAGER");
  // The SAME pair, opposite directions, different templates.
});

test("§9.2 anyone else is a peer", () => {
  assert.equal(
    templateTypeFor({
      rater: person("a", { managerId: "x" }),
      ratee: person("b", { managerId: "y" }),
    }),
    "PEER_TO_PEER",
  );
});

test("nobody assesses themselves", () => {
  assert.equal(templateTypeFor({ rater: person("a"), ratee: person("a") }), null);
});

// --- §8.3's exemption ---------------------------------------------------------------

test("§8.3 C-Level are outside the 360 entirely, as rater and as ratee", () => {
  assert.equal(isThreeSixtyExempt("C_LEVEL"), true);
  for (const t of ["DIRECTOR", "MANAGER", "LEAD", "INDIVIDUAL"] as const) {
    assert.equal(isThreeSixtyExempt(t), false);
  }
});

// --- §9.4's three raters -------------------------------------------------------------

test("§9.4 line manager + peer + reportee, in that order", () => {
  const { raterIds, shortfall } = proposeRaters({
    ratee: person("emp"),
    lineManager: person("mgr", { managerId: "boss" }),
    reports: [person("kid", { managerId: "emp" })],
    peerPool: [person("peer1"), person("peer2")],
  });
  assert.deepEqual(raterIds, ["mgr", "peer1", "kid"]);
  assert.equal(shortfall, 0);
});

test("§9.4 with no reportee, the third is a SECOND peer", () => {
  const { raterIds, shortfall } = proposeRaters({
    ratee: person("emp"),
    lineManager: person("mgr", { managerId: "boss" }),
    reports: [],
    peerPool: [person("peer1"), person("peer2"), person("peer3")],
  });
  assert.deepEqual(raterIds, ["mgr", "peer1", "peer2"]);
  assert.equal(shortfall, 0);
});

test("§9.4 a shortfall is REPORTED, not padded", () => {
  // A sole employee in a one-person department with no reports. Papering over
  // this would change §9.5's denominator silently; HR must see it (§9.6).
  const { raterIds, shortfall } = proposeRaters({
    ratee: person("emp"),
    lineManager: person("mgr", { managerId: "boss" }),
    reports: [],
    peerPool: [],
  });
  assert.deepEqual(raterIds, ["mgr"]);
  assert.equal(shortfall, 2);
});

test("§8.3 a C-Level manager is not drafted as a rater", () => {
  const { raterIds, shortfall } = proposeRaters({
    ratee: person("emp"),
    lineManager: person("ceo", { roleTrack: "C_LEVEL", managerId: null }),
    reports: [],
    peerPool: [person("peer1")],
  });
  assert.deepEqual(raterIds, ["peer1"]);
  assert.equal(shortfall, 2);
});

test("§12.1 a leaver is not drafted as a rater", () => {
  const { raterIds } = proposeRaters({
    ratee: person("emp"),
    lineManager: person("mgr", { status: "LEAVER", managerId: "boss" }),
    reports: [],
    peerPool: [person("peer1"), person("peer2")],
  });
  assert.deepEqual(raterIds, ["peer1", "peer2"]);
});

test("the same person is never assigned twice", () => {
  // A manager who is also in the peer pool must not fill two of the three slots.
  const mgr = person("mgr", { managerId: "boss" });
  const { raterIds } = proposeRaters({
    ratee: person("emp"),
    lineManager: mgr,
    reports: [],
    peerPool: [mgr, person("peer2")],
  });
  assert.deepEqual(raterIds, ["mgr", "peer2"]);
});

// --- §9.7's activation gate -----------------------------------------------------------

const FULL_TEMPLATES = [
  { type: "LINE_MANAGER_TO_EMPLOYEE" as const, questionCount: 8 },
  { type: "EMPLOYEE_TO_LINE_MANAGER" as const, questionCount: 8 },
  { type: "PEER_TO_PEER" as const, questionCount: 8 },
];

test("§9.7 a complete cycle activates", () => {
  assert.equal(
    activationBlockedReason({
      templates: FULL_TEMPLATES,
      counts: [{ rateeId: "a", raterCount: 3 }],
      participantCount: 1,
    }),
    null,
  );
});

test("§9.2 a missing template blocks activation, and names which", () => {
  const reason = activationBlockedReason({
    templates: FULL_TEMPLATES.slice(0, 2),
    counts: [{ rateeId: "a", raterCount: 3 }],
    participantCount: 1,
  });
  assert.match(reason as string, /PEER_TO_PEER/);
});

test("a template with no questions blocks activation", () => {
  const reason = activationBlockedReason({
    templates: [...FULL_TEMPLATES.slice(0, 2), { type: "PEER_TO_PEER" as const, questionCount: 0 }],
    counts: [{ rateeId: "a", raterCount: 3 }],
    participantCount: 1,
  });
  assert.match(reason as string, /no questions/);
});

test("§9.4 too FEW raters blocks activation", () => {
  const reason = activationBlockedReason({
    templates: FULL_TEMPLATES,
    counts: [
      { rateeId: "a", raterCount: 3 },
      { rateeId: "b", raterCount: 2 },
    ],
    participantCount: 2,
  });
  assert.match(reason as string, /1 employee\(s\) have fewer/);
});

test("§9.4 too MANY raters blocks activation too", () => {
  // Both directions are wrong: extra raters mean someone was assigned twice by
  // hand, and §9.5 would average over a denominator the spec does not state.
  const reason = activationBlockedReason({
    templates: FULL_TEMPLATES,
    counts: [{ rateeId: "a", raterCount: 4 }],
    participantCount: 1,
  });
  assert.match(reason as string, /have more/);
});

test("an empty cycle cannot be activated", () => {
  assert.match(
    activationBlockedReason({
      templates: FULL_TEMPLATES,
      counts: [],
      participantCount: 0,
    }) as string,
    /No one is enrolled/,
  );
});

// --- §9.5's arithmetic, using the SPEC'S OWN worked example ---------------------------

const answers = (scores: (number | null)[]) => scores.map((score) => ({ score, scored: true }));

test("§9.5 the spec's worked example: 85, 96, 84 out of 96 → 0.92 → 4.60", () => {
  // "forms max = 96. Raw totals: LM→Emp 85, Emp→LM 96, Peer 84 → ratios 0.89,
  // 1.00, 0.88 → average 0.92". 96 max = 24 scored questions × 4.
  // Build 24 answers on the 1-4 scale summing EXACTLY to `total`. Each question
  // starts at the scale's floor of 1 and takes up to 3 more.
  const form = (total: number) => {
    const N = 24;
    let extra = total - N; // how much above the all-1s floor
    const scores = Array.from({ length: N }, () => {
      const add = Math.min(3, Math.max(0, extra));
      extra -= add;
      return 1 + add;
    });
    assert.equal(
      scores.reduce((a, b) => a + b, 0),
      total,
      `the fixture must sum to ${total}`,
    );
    return answers(scores);
  };
  const lm = formRatio(form(85))!;
  const empToLm = formRatio(form(96))!;
  const peer = formRatio(form(84))!;

  assert.equal(lm.toFixed(2), "0.89");
  assert.equal(empToLm.toString(), "1");
  assert.equal(peer.toFixed(2), "0.88");

  const overall = overallRatio([lm, empToLm, peer])!;
  assert.equal(overall.toFixed(2), "0.92");
  // §8.5 — carried into the formula as ratio × 5.
  assert.equal(overall.times(5).toFixed(2), "4.60");
});

test("§9.5 the denominator is the form's MAXIMUM, not the number answered", () => {
  // A rater who answers half the form has produced a LOW ratio, not a ratio over
  // what they bothered with. §9.7's status tracking is what surfaces the gap.
  const ratio = formRatio([
    { score: 4, scored: true },
    { score: 4, scored: true },
    { score: null, scored: true },
    { score: null, scored: true },
  ]);
  assert.equal(ratio?.toString(), "0.5"); // 8 / 16, not 8 / 8
});

test("§9.5 open-ended answers never enter the score", () => {
  // "sum the answered question SCORES" — a text answer has none, and counting it
  // as a zero would punish a rater for writing feedback.
  const ratio = formRatio([
    { score: 4, scored: true },
    { score: 4, scored: true },
    { score: null, scored: false },
  ]);
  assert.equal(ratio?.toString(), "1"); // 8 / 8
});

test("a form with no scored questions has no ratio, rather than 0", () => {
  assert.equal(formRatio([{ score: null, scored: false }]), null);
});

test("§9.3 a score off the scale throws rather than skewing the ratio", () => {
  assert.throws(() => formRatio([{ score: 5, scored: true }]), /not on the 4-point scale/);
});

test("§9.5 averaging over what EXISTS, when a rater has left mid-cycle", () => {
  // §12.1 flags the reassignment to HR. Until then, dividing by a hard 3 would
  // silently penalise the ratee for someone else's departure.
  const two = overallRatio([new Prisma.Decimal("1"), new Prisma.Decimal("0.5")]);
  assert.equal(two?.toString(), "0.75");
  assert.equal(overallRatio([]), null);
});

test("§9.4's constant is three", () => {
  assert.equal(RATERS_PER_EMPLOYEE, 3);
});

// --- §9.7's fourth status and its reminders --------------------------------

test("§9.7 Overdue is DERIVED from the deadline, never a stored fourth state", () => {
  const deadline = new Date("2027-07-31T23:59:59Z");
  const before = new Date("2027-07-30T00:00:00Z");
  const after = new Date("2027-08-01T00:00:00Z");

  assert.equal(evaluatorStatus({ stored: "NOT_STARTED", deadline, now: before }), "NOT_STARTED");
  assert.equal(evaluatorStatus({ stored: "IN_PROGRESS", deadline, now: before }), "IN_PROGRESS");
  assert.equal(evaluatorStatus({ stored: "NOT_STARTED", deadline, now: after }), "OVERDUE");
  assert.equal(evaluatorStatus({ stored: "IN_PROGRESS", deadline, now: after }), "OVERDUE");
});

test("§9.7 a submitted assessment is never overdue, whenever it arrived", () => {
  // §9.7 tracks who still OWES an assessment. Someone who answered owes nothing,
  // and marking them overdue would put them on a chase list forever.
  const deadline = new Date("2027-07-31T23:59:59Z");
  assert.equal(
    evaluatorStatus({ stored: "SUBMITTED", deadline, now: new Date("2027-12-31T00:00:00Z") }),
    "SUBMITTED",
  );
});

test("§9.7 reminders fire inside the window and stop at the deadline", () => {
  const deadline = new Date("2027-07-31T00:00:00Z");
  const outside = new Date("2027-07-01T00:00:00Z");
  const inside = new Date("2027-07-28T00:00:00Z");
  const past = new Date("2027-08-01T00:00:00Z");

  assert.equal(isReminderDue({ deadline, now: outside }), false, "not a month out");
  assert.equal(isReminderDue({ deadline, now: inside }), true);
  assert.equal(
    isReminderDue({ deadline, now: past }),
    false,
    "past the deadline it is an overdue, not a reminder",
  );
  // Exactly on the boundary of the window.
  assert.equal(
    isReminderDue({
      deadline,
      now: new Date(deadline.getTime() - THREE_SIXTY_REMINDER_DAYS * 86_400_000),
    }),
    true,
  );
});

// --- §9.7 may this rater answer right now? ------------------------------------

/**
 * The gate the answering form (§9.7) and the write path both stand behind. It
 * exists as one function because a form the UI renders and the route then
 * refuses is the worst outcome: the rater types out an assessment and loses it
 * at submit.
 */
test("§9.7 a draft cycle cannot be answered — it was never launched", () => {
  const r = answerBlockedReason({
    cycleStatus: "DRAFT",
    opensAt: new Date("2027-01-01"),
    deadline: new Date("2027-12-31"),
    assignmentStatus: "NOT_STARTED",
    now: new Date("2027-06-01"),
  });
  assert.match(String(r?.reason), /not been activated/);
  assert.equal(r?.status, 409);
});

test("§9.8 a closed cycle cannot be answered — results are already calculated", () => {
  const r = answerBlockedReason({
    cycleStatus: "CLOSED",
    opensAt: new Date("2027-01-01"),
    deadline: new Date("2027-12-31"),
    assignmentStatus: "NOT_STARTED",
    now: new Date("2027-06-01"),
  });
  assert.match(String(r?.reason), /closed/);
});

test("§5.4's hard lock carries into §9: past the deadline the form is locked", () => {
  const r = answerBlockedReason({
    cycleStatus: "ACTIVE",
    opensAt: new Date("2027-01-01"),
    deadline: new Date("2027-06-30"),
    assignmentStatus: "IN_PROGRESS",
    now: new Date("2027-07-01"),
  });
  assert.match(String(r?.reason), /deadline has passed/);
});

test("§9.7 submission is one-way — a submitted assessment cannot be reopened", () => {
  const r = answerBlockedReason({
    cycleStatus: "ACTIVE",
    opensAt: new Date("2027-01-01"),
    deadline: new Date("2027-12-31"),
    assignmentStatus: "SUBMITTED",
    now: new Date("2027-06-01"),
  });
  assert.match(String(r?.reason), /already been submitted/);
});

test("§9.7 an active cycle inside its window, not yet submitted, is answerable", () => {
  const open = answerBlockedReason({
    cycleStatus: "ACTIVE",
    opensAt: new Date("2027-01-01"),
    deadline: new Date("2027-12-31"),
    assignmentStatus: "IN_PROGRESS",
    now: new Date("2027-06-01"),
  });
  assert.equal(open, null);

  // …and not before it opens.
  const early = answerBlockedReason({
    cycleStatus: "ACTIVE",
    opensAt: new Date("2027-06-01"),
    deadline: new Date("2027-12-31"),
    assignmentStatus: "NOT_STARTED",
    now: new Date("2027-05-31"),
  });
  assert.match(String(early?.reason), /has not opened/);
});

// --- §9.1 / §9.2 the setup the new HR screen writes ----------------------------

const template = (type: string, questions = [{ text: "Is dependable", scored: true }]) => ({
  type,
  questions,
});
const validCreate = {
  cycleId: "c1",
  opensAt: "2027-11-01T00:00:00.000Z",
  deadline: "2027-12-15T00:00:00.000Z",
  templates: [
    template("LINE_MANAGER_TO_EMPLOYEE"),
    template("EMPLOYEE_TO_LINE_MANAGER"),
    template("PEER_TO_PEER"),
  ],
};

test("§9.2 all three assessment types are required, exactly once each", async () => {
  const { createThreeSixtyCycleSchema } = await import("../../lib/validations/three-sixty");

  assert.equal(createThreeSixtyCycleSchema.safeParse(validCreate).success, true);

  // Two of one type and none of another still totals three templates — the
  // length check alone would let that through, which is why the refine exists.
  const duplicated = {
    ...validCreate,
    templates: [
      template("PEER_TO_PEER"),
      template("PEER_TO_PEER"),
      template("LINE_MANAGER_TO_EMPLOYEE"),
    ],
  };
  assert.equal(createThreeSixtyCycleSchema.safeParse(duplicated).success, false);

  const missingOne = { ...validCreate, templates: validCreate.templates.slice(0, 2) };
  assert.equal(createThreeSixtyCycleSchema.safeParse(missingOne).success, false);
});

test("§9.2 a template with no questions cannot be created — it could not be answered", async () => {
  const { createThreeSixtyCycleSchema } = await import("../../lib/validations/three-sixty");
  const empty = {
    ...validCreate,
    templates: [
      template("LINE_MANAGER_TO_EMPLOYEE", []),
      template("EMPLOYEE_TO_LINE_MANAGER"),
      template("PEER_TO_PEER"),
    ],
  };
  assert.equal(createThreeSixtyCycleSchema.safeParse(empty).success, false);
});

test("§9.1 the deadline must fall after the cycle opens", async () => {
  const { createThreeSixtyCycleSchema } = await import("../../lib/validations/three-sixty");
  const backwards = {
    ...validCreate,
    opensAt: "2027-12-15T00:00:00.000Z",
    deadline: "2027-11-01T00:00:00.000Z",
  };
  assert.equal(createThreeSixtyCycleSchema.safeParse(backwards).success, false);

  // Equal is not after.
  const same = { ...validCreate, deadline: validCreate.opensAt };
  assert.equal(createThreeSixtyCycleSchema.safeParse(same).success, false);
});

test("§9.2 an open-ended question is stored as such, not defaulted to scored", async () => {
  const { createThreeSixtyCycleSchema } = await import("../../lib/validations/three-sixty");
  const withOpen = {
    ...validCreate,
    templates: [
      template("LINE_MANAGER_TO_EMPLOYEE", [
        { text: "Is dependable", scored: true },
        { text: "Anything else?", scored: false },
      ]),
      template("EMPLOYEE_TO_LINE_MANAGER"),
      template("PEER_TO_PEER"),
    ],
  };
  const parsed = createThreeSixtyCycleSchema.safeParse(withOpen);
  assert.equal(parsed.success, true);
  // §9.5 divides by the SCORED maximum, so this flag decides the denominator.
  assert.equal(parsed.success && parsed.data.templates[0].questions[1].scored, false);
});
