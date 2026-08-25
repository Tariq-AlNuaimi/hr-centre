import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "../../generated/prisma/client";

import {
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
