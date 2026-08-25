import test from "node:test";
import assert from "node:assert/strict";

import {
  RATING_LEVELS,
  divergenceBlockedReason,
  isRatingLevel,
  ratingBlockedReason,
} from "../../lib/pms/rating";
import {
  yearEndSignBlockedReason,
  yearEndSignerBlockedReason,
  yearEndState,
} from "../../lib/pms/year-end";
import type { StageWindow } from "../../lib/pms/cycle";
import type { PmsActor } from "../../lib/pms/permissions";

/**
 * §7.1 — the year-end assessment.
 *
 * Two rules here are NOT in the spec and were decided by the operator, so they
 * are the ones most likely to be quietly reverted by someone reading §7 alone.
 * Both are pinned:
 *
 *   1. the manager SEES the self-assessment while reviewing (so §7.1's order is
 *      enforced: the employee goes first, and the manager cannot rate an
 *      unassessed KPI)
 *   2. a divergent manager rating REQUIRES a written reason
 */

const actor = (over: Partial<PmsActor> = {}): PmsActor => ({
  userId: "u1",
  employeeId: "mgr",
  pmsRoles: [],
  isLineManager: true,
  ...over,
});
const employee = actor({ employeeId: "emp", isLineManager: false });
const hr = actor({ employeeId: "hr", pmsRoles: ["HR_SUPER_ADMIN"], isLineManager: false });
const stranger = actor({ employeeId: "other", isLineManager: false });

const subject = { id: "emp", managerId: "mgr", roleTrack: "INDIVIDUAL" as const };

const YEAR_END: StageWindow = {
  kind: "YEAR_END",
  opensAt: new Date("2027-12-01T00:00:00Z"),
  deadline: new Date("2027-12-31T23:59:00Z"),
  graceDays: 3,
};
const DURING = new Date("2027-12-15T00:00:00Z");
const AFTER = new Date("2028-01-05T00:00:00Z");
const APPROVED = new Date("2026-12-20T00:00:00Z");

const rate = (over: Partial<Parameters<typeof ratingBlockedReason>[0]> = {}) =>
  ratingBlockedReason({
    actor: employee,
    party: "EMPLOYEE",
    subject,
    stage: YEAR_END,
    now: DURING,
    goalsApprovedAt: APPROVED,
    employeeRated: false,
    ...over,
  });

// --- §8.1's scale --------------------------------------------------------------

test("§8.1 the five levels map to the five descriptors, highest first", () => {
  assert.deepEqual(
    RATING_LEVELS.map((l) => l.level),
    [5, 4, 3, 2, 1],
  );
  assert.equal(RATING_LEVELS[0].field, "descriptorOutstanding");
  assert.equal(RATING_LEVELS[4].field, "descriptorUnsatisfactory");
});

test("§8.1 only 1-5 is a rating", () => {
  for (const level of [1, 2, 3, 4, 5]) assert.equal(isRatingLevel(level), true);
  for (const level of [0, 6, -1, 3.5, NaN, Infinity]) {
    assert.equal(isRatingLevel(level), false, `${level} is not a level`);
  }
});

// --- §7.1's ORDER: the employee goes first -------------------------------------

test("§7.1 the employee self-assesses first", () => {
  assert.equal(rate(), null);
});

test("§7.1 the manager cannot review a KPI nobody has self-assessed", () => {
  // The load-bearing case for the order. A manager who could rate an unassessed
  // KPI turns "reviews" into "rates on their behalf", and the employee's own
  // view of their year is never recorded at all.
  const refusal = rate({ actor: actor(), party: "MANAGER", employeeRated: false });
  assert.equal(refusal?.status, 409);
  assert.match(refusal?.reason as string, /not been self-assessed/i);
  assert.match(refusal?.reason as string, /§7\.1/);
});

test("§7.1 the manager reviews once the employee has rated", () => {
  assert.equal(rate({ actor: actor(), party: "MANAGER", employeeRated: true }), null);
});

test("§7.1 nobody self-assesses on someone else's behalf — not the manager, not HR", () => {
  // 404, not 403: the same existence-oracle rule (§4.2).
  assert.equal(rate({ actor: actor(), party: "EMPLOYEE" })?.status, 404);
  assert.equal(rate({ actor: hr, party: "EMPLOYEE" })?.status, 404);
});

test("§4.2 a stranger reviewing gets 404, not 403", () => {
  assert.equal(rate({ actor: stranger, party: "MANAGER", employeeRated: true })?.status, 404);
});

test("§4.1 HR may review org-wide", () => {
  assert.equal(rate({ actor: hr, party: "MANAGER", employeeRated: true }), null);
});

// --- §8.3, §5.1, §5.4 ----------------------------------------------------------

test("§8.3 C-Level skip self-assessment entirely, and that is answered first", () => {
  const refusal = rate({
    subject: { ...subject, roleTrack: "C_LEVEL" },
    goalsApprovedAt: null,
    stage: null,
  });
  assert.equal(refusal?.status, 409);
  assert.match(refusal?.reason as string, /C-Level/);
  assert.match(refusal?.reason as string, /§8\.3/);
});

test("§5.1 there is nothing to assess against without an approved baseline", () => {
  assert.match(rate({ goalsApprovedAt: null })?.reason as string, /no HR-approved baseline/i);
});

test("§5.4 the year-end deadline is a hard lock, and says which lock it was", () => {
  assert.match(rate({ now: AFTER })?.reason as string, /deadline has passed/i);
  assert.match(
    rate({ now: new Date("2027-06-01T00:00:00Z") })?.reason as string,
    /has not opened/i,
  );
});

test("a cycle with no year-end stage refuses clearly", () => {
  assert.match(rate({ stage: null })?.reason as string, /no year-end stage/i);
});

// --- the divergence rule (operator decision, NOT in the spec) -------------------

test("a manager who rates differently must say why", () => {
  const reason = divergenceBlockedReason({
    party: "MANAGER",
    level: 2,
    employeeLevel: 4,
    comment: null,
  });
  assert.ok(reason);
  assert.match(reason as string, /lower/);
  assert.match(reason as string, /\(2\)/);
  assert.match(reason as string, /\(4\)/);
});

test("…and rating HIGHER than the employee needs a reason too", () => {
  // Not only downgrades. An unexplained bump is what §10's calibration has to
  // defend later, and it is the one people never think to justify.
  const reason = divergenceBlockedReason({
    party: "MANAGER",
    level: 5,
    employeeLevel: 3,
    comment: null,
  });
  assert.match(reason as string, /higher/);
});

test("agreeing needs no comment", () => {
  assert.equal(
    divergenceBlockedReason({ party: "MANAGER", level: 3, employeeLevel: 3, comment: null }),
    null,
  );
});

test("a comment satisfies the rule; whitespace does not", () => {
  assert.equal(
    divergenceBlockedReason({ party: "MANAGER", level: 2, employeeLevel: 4, comment: "Missed Q3" }),
    null,
  );
  assert.ok(
    divergenceBlockedReason({ party: "MANAGER", level: 2, employeeLevel: 4, comment: "   " }),
    "whitespace is not an explanation",
  );
});

test("the rule never applies to a self-assessment", () => {
  // A self-assessment has nothing to diverge FROM, and demanding a justification
  // for one's own view of one's own year is a different and worse rule.
  assert.equal(
    divergenceBlockedReason({ party: "EMPLOYEE", level: 5, employeeLevel: null, comment: null }),
    null,
  );
});

test("the manager rating first — before any self-assessment — needs no comment", () => {
  // Cannot happen through the route (§7.1's order refuses it), so this asserts
  // the function does not invent a requirement out of a null.
  assert.equal(
    divergenceBlockedReason({ party: "MANAGER", level: 1, employeeLevel: null, comment: null }),
    null,
  );
});

// --- where the assessment stands ------------------------------------------------

const KPIS = [{ id: "k1" }, { id: "k2" }, { id: "k3" }];

test("an untouched set is empty, not complete", () => {
  const state = yearEndState(KPIS, []);
  assert.deepEqual(
    { ...state, divergentKpiIds: state.divergentKpiIds },
    { kpiCount: 3, employeeRated: 0, managerRated: 0, complete: false, divergentKpiIds: [] },
  );
});

test("complete means BOTH parties rated EVERY KPI", () => {
  const half = yearEndState(KPIS, [
    { kpiId: "k1", party: "EMPLOYEE", level: 3 },
    { kpiId: "k2", party: "EMPLOYEE", level: 4 },
    { kpiId: "k3", party: "EMPLOYEE", level: 5 },
  ]);
  assert.equal(half.complete, false, "one party is not both");

  const all = yearEndState(KPIS, [
    ...KPIS.map((k) => ({ kpiId: k.id, party: "EMPLOYEE" as const, level: 3 })),
    ...KPIS.map((k) => ({ kpiId: k.id, party: "MANAGER" as const, level: 3 })),
  ]);
  assert.equal(all.complete, true);
});

test("an EMPTY KPI set is never complete", () => {
  // Otherwise a participant with no KPIs is signable, producing a signed
  // assessment of nothing.
  assert.equal(yearEndState([], []).complete, false);
});

test("divergence is reported per KPI", () => {
  const state = yearEndState(KPIS, [
    { kpiId: "k1", party: "EMPLOYEE", level: 4 },
    { kpiId: "k1", party: "MANAGER", level: 2 },
    { kpiId: "k2", party: "EMPLOYEE", level: 3 },
    { kpiId: "k2", party: "MANAGER", level: 3 },
  ]);
  assert.deepEqual(state.divergentKpiIds, ["k1"]);
});

test("a rating whose KPI has left the set is ignored, not counted", () => {
  // A KPI withdrawn after being rated must not make the set look more complete
  // than it is, nor be signable against something that no longer exists.
  const state = yearEndState(KPIS, [
    { kpiId: "gone", party: "EMPLOYEE", level: 3 },
    { kpiId: "gone", party: "MANAGER", level: 3 },
  ]);
  assert.equal(state.employeeRated, 0);
  assert.equal(state.kpiCount, 3);
});

// --- §7.1's signatures -----------------------------------------------------------

const complete = yearEndState(KPIS, [
  ...KPIS.map((k) => ({ kpiId: k.id, party: "EMPLOYEE" as const, level: 3 })),
  ...KPIS.map((k) => ({ kpiId: k.id, party: "MANAGER" as const, level: 3 })),
]);

test("§7.1 a fully-rated assessment is signable", () => {
  assert.equal(yearEndSignBlockedReason({ state: complete, stage: YEAR_END, now: DURING }), null);
});

test("§7.1 a half-rated assessment is not, and the refusal counts what is missing", () => {
  const partial = yearEndState(KPIS, [
    { kpiId: "k1", party: "EMPLOYEE", level: 3 },
    { kpiId: "k1", party: "MANAGER", level: 3 },
  ]);
  const reason = yearEndSignBlockedReason({ state: partial, stage: YEAR_END, now: DURING });
  assert.match(reason as string, /1 of 3/);
});

test("§5.4 signing is locked by the deadline too", () => {
  assert.match(
    yearEndSignBlockedReason({ state: complete, stage: YEAR_END, now: AFTER }) as string,
    /deadline has passed/i,
  );
});

test("§7.1 each party signs for themselves; a stranger gets 404", () => {
  assert.equal(yearEndSignerBlockedReason({ actor: employee, party: "EMPLOYEE", subject }), null);
  assert.equal(yearEndSignerBlockedReason({ actor: actor(), party: "MANAGER", subject }), null);
  assert.equal(
    yearEndSignerBlockedReason({ actor: stranger, party: "MANAGER", subject })?.status,
    404,
  );
  assert.equal(
    yearEndSignerBlockedReason({ actor: actor(), party: "EMPLOYEE", subject })?.status,
    404,
    "a manager cannot sign as the employee",
  );
});

test("HR cannot sign in the line manager's place", () => {
  // §4.1 gives HR org-wide authority, but a signature is a named person's
  // statement of agreement. §5.5 gives HR the real path past a stuck signature.
  const refusal = yearEndSignerBlockedReason({ actor: hr, party: "MANAGER", subject });
  assert.equal(refusal?.status, 403);
  assert.match(refusal?.reason as string, /cannot sign in their place/i);
  assert.match(refusal?.reason as string, /§5\.5/);
});

test("§7.2 whoever is manager AT THE MOMENT signs — the relationship is read live", () => {
  // A manager who inherits a report in November signs their year-end; the
  // previous manager no longer can.
  const moved = { id: "emp", managerId: "new-mgr" };
  assert.equal(
    yearEndSignerBlockedReason({
      actor: actor({ employeeId: "new-mgr" }),
      party: "MANAGER",
      subject: moved,
    }),
    null,
  );
  assert.equal(
    yearEndSignerBlockedReason({ actor: actor(), party: "MANAGER", subject: moved })?.status,
    404,
    "the previous manager is now a stranger to this participant",
  );
});
