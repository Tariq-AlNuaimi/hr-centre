import test from "node:test";
import assert from "node:assert/strict";

import {
  KPI_LEVELS,
  GOAL_SETTING_STAGE,
  isWeightageComplete,
  kpiEditBlockedReason,
  kpiSetAccessRefusal,
  signOffBlockedReason,
  weightageGap,
  weightageMessage,
  weightageTotal,
  type WeightedKpi,
} from "../../lib/pms/kpi";
import { isGoalSettingExempt, type StageWindow } from "../../lib/pms/cycle";
import type { PmsActor } from "../../lib/core/permissions";
import { createKpiSchema, updateKpiSchema } from "../../lib/validations/kpi";

/**
 * KPI drafting contract — spec §5.1 (HR approval is the lock), §5.2 (what a
 * manager authors), §5.3 (exactly 100%), §5.4 (deadlines are hard locks), §4.2
 * (the direct line manager acts, the chain below is view-only) and §8.3 (C-Level
 * skip goal-setting entirely).
 *
 * DB-free by construction: every rule under test is a pure function over an
 * actor, a stage window and a set of weightages, which is precisely why they
 * live in lib/pms/kpi.ts rather than inside a route handler.
 *
 *   npx tsx --test tests/contracts/pms-kpi.test.ts
 */

// December goal-setting, the window §5.4's hard lock closes.
const GOAL_SETTING: StageWindow = {
  kind: "GOAL_SETTING",
  opensAt: new Date("2026-12-01T00:00:00Z"),
  deadline: new Date("2026-12-31T23:59:59Z"),
  graceDays: 3,
};

const DURING = new Date("2026-12-15T09:00:00Z");
const AFTER = new Date("2027-01-01T00:00:00Z");

const actor = (over: Partial<PmsActor> = {}): PmsActor => ({
  userId: "u-manager",
  employeeId: "mgr-1",
  pmsRoles: [],
  isLineManager: true,
  ...over,
});

/** A direct report of mgr-1. */
const DIRECT_REPORT = { id: "emp-1", managerId: "mgr-1" };
/** Two levels down: visible to mgr-1 (§4.2 chain view) but NOT actionable. */
const SKIP_LEVEL_REPORT = { id: "emp-2", managerId: "lead-9" };

const w = (...values: (string | number)[]): WeightedKpi[] => values.map((v) => ({ weightage: v }));

const editable = (over: Partial<Parameters<typeof kpiEditBlockedReason>[0]> = {}) =>
  kpiEditBlockedReason({
    actor: actor(),
    target: DIRECT_REPORT,
    stage: GOAL_SETTING,
    now: DURING,
    goalsApprovedAt: null,
    ...over,
  });

// --- §5.2 what a manager authors -------------------------------------------

test("§5.2 there are exactly five levels, Outstanding 5 down to Unsatisfactory 1", () => {
  assert.equal(KPI_LEVELS.length, 5, "five levels, no more and no fewer");
  assert.deepEqual(
    KPI_LEVELS.map((l) => l.value),
    [5, 4, 3, 2, 1],
    "descending, because the form reads top-down from the best outcome",
  );
  assert.deepEqual(
    KPI_LEVELS.map((l) => l.label),
    ["Outstanding", "Excellent", "Target", "Almost Achieved", "Unsatisfactory"],
  );
});

test("§5.2 a KPI with a blank descriptor is refused at the boundary", () => {
  const complete = {
    participantId: "p-1",
    description: "Ship the platform migration",
    weightage: 40,
    descriptorOutstanding: "Delivered a quarter early",
    descriptorExcellent: "Delivered early",
    descriptorTarget: "Delivered on plan",
    descriptorAlmostAchieved: "Delivered late",
    descriptorUnsatisfactory: "Not delivered",
    orderIndex: 0,
  };
  assert.equal(createKpiSchema.safeParse(complete).success, true);
  assert.equal(
    createKpiSchema.safeParse({ ...complete, descriptorTarget: "   " }).success,
    false,
    "a whitespace descriptor reaches the employee as an unlabelled rating scale",
  );
  assert.equal(
    createKpiSchema.safeParse({ ...complete, weightage: 100.5 }).success,
    false,
    "a single KPI cannot exceed 100%",
  );
  assert.equal(updateKpiSchema.safeParse({ weightage: 25 }).success, true, "partial edits allowed");
});

test("§5.2 an empty update body is rejected — the guard fires (was a defect, now fixed)", () => {
  // History worth keeping: `updateKpiSchema` was built as
  // `kpiInputSchema.partial()`, and `orderIndex` carried `.default(0)`. A default
  // SURVIVES `.partial()`, so `{}` parsed to `{ orderIndex: 0 }` — one key, refine
  // satisfied. Two consequences: the "Nothing to update" message was unreachable,
  // and any partial edit omitting `orderIndex` silently moved the KPI back to
  // position 0, reordering a manager's list behind their back.
  //
  // Fixed in lib/validations/kpi.ts by building the update schema from an
  // UNDEFAULTED field shape; the create schema keeps its default. The route's
  // raw-body guard stays as defence in depth.
  const empty = updateKpiSchema.safeParse({});
  assert.equal(empty.success, false, "an empty body carries no intent");
  if (!empty.success) assert.match(empty.error.issues[0].message, /Nothing to update/);

  const reword = updateKpiSchema.safeParse({ description: "same KPI, better wording" });
  assert.equal(reword.success, true);
  assert.deepEqual(
    reword.success ? Object.keys(reword.data) : null,
    ["description"],
    "an omitted orderIndex stays omitted — the KPI keeps its place in the list",
  );
});

// --- §5.3 the exactly-100 rule ----------------------------------------------

test("§5.3 a set totalling exactly 100 is signable, and says nothing about it", () => {
  const set = w("40", "35", "25");
  assert.equal(weightageTotal(set).toString(), "100");
  assert.equal(isWeightageComplete(set), true);
  assert.equal(weightageMessage(set), null, "no message IS the pass signal");
});

test("§5.3 99.99 fails, and the message names the missing 0.01", () => {
  const set = w("33.33", "33.33", "33.33");
  assert.equal(isWeightageComplete(set), false, "close is not exactly 100");
  assert.equal(weightageGap(set).toString(), "-0.01");
  assert.equal(
    weightageMessage(set),
    "Weightages total 99.99% — 0.01% short of the 100% required to sign off.",
    "the gap has to be actionable — 'invalid' is not a number anyone can fix",
  );
});

test("§5.3 100.01 fails too — the rule has no upward tolerance either", () => {
  const set = w("50", "50.01");
  assert.equal(isWeightageComplete(set), false);
  assert.equal(weightageGap(set).toString(), "0.01");
  assert.equal(
    weightageMessage(set),
    "Weightages total 100.01% — 0.01% over the 100% allowed to sign off.",
  );
});

test("§5.3 the 95% draft says which 5% is missing (the blueprint's worst path)", () => {
  assert.equal(
    weightageMessage(w("50", "45")),
    "Weightages total 95% — 5% short of the 100% required to sign off.",
  );
});

test("§5.3 the total is decimal arithmetic, not floating point", () => {
  // 0.1 + 0.2 !== 0.3 in IEEE-754; three thirds plus a hundredth is exactly 100
  // only if the sum is decimal. This is the whole reason weightage is a Decimal.
  assert.equal(weightageTotal(w("0.1", "0.2")).toString(), "0.3");
  assert.equal(isWeightageComplete(w("33.33", "33.33", "33.33", "0.01")), true);
  assert.equal(
    isWeightageComplete(w(20.2, 20.2, 20.2, 20.2, 19.2)),
    true,
    "numbers coerce through the same decimal path as strings",
  );
});

test("§5.1/§5.3 an empty set is not a 100% set — it is a manager who has not drafted", () => {
  assert.equal(isWeightageComplete([]), false);
  assert.equal(
    weightageMessage([]),
    "This employee has no KPIs yet. A manager drafts them before either party signs.",
    "zero KPIs must not read as 'you are 100% short' — the fix is drafting, not arithmetic",
  );
});

test("§5.3 sign-off is refused at 99.99 with the gap stated (US-11)", () => {
  assert.equal(
    signOffBlockedReason({ kpis: w("33.33", "33.33", "33.33"), stage: GOAL_SETTING, now: DURING }),
    "Weightages total 99.99% — 0.01% short of the 100% required to sign off.",
  );
  assert.equal(
    signOffBlockedReason({ kpis: w("40", "60"), stage: GOAL_SETTING, now: DURING }),
    null,
  );
});

// --- §5.1 HR approval is the lock -------------------------------------------

test("§5.1 an unapproved set is editable inside the window", () => {
  assert.equal(editable(), null, "the resting state during goal-setting is 'yes'");
});

test("§5.1 HR approval blocks the edit, and points at the change-request path", () => {
  const reason = editable({ goalsApprovedAt: new Date("2026-12-20T10:00:00Z") });
  assert.equal(
    reason,
    "HR has approved this KPI set, which locks it as the agreed baseline. " +
      "A change now goes through a mid-year change request.",
    "the blueprint's 'just fix a typo' worst path — refused, with the real route named",
  );
});

test("§5.1 approval locks HR out too — the lock is the baseline, not a permission", () => {
  const reason = editable({
    actor: actor({ userId: "u-hr", employeeId: "hr-1", pmsRoles: ["HR_SUPER_ADMIN"] }),
    goalsApprovedAt: new Date("2026-12-20T10:00:00Z"),
  });
  assert.match(reason ?? "", /HR-approved|approv/i, "HR's own approval is what froze it");
});

test("§5.1 sign-off is NOT the lock: signatures do not appear in the edit gate", () => {
  // The gate takes no signature argument at all — §5.1 is explicit that sign-off
  // is agreement and HR approval is the lock, so a signed-but-unapproved set is
  // still editable. Asserted structurally: the only lock input is goalsApprovedAt.
  assert.equal(editable({ goalsApprovedAt: null }), null);
});

// --- §5.4 deadlines are hard locks ------------------------------------------

test("§5.4 one second past the deadline the manager can no longer act", () => {
  const oneSecondBefore = new Date(GOAL_SETTING.deadline.getTime() - 1000);
  assert.equal(editable({ now: oneSecondBefore }), null);
  assert.equal(editable({ now: GOAL_SETTING.deadline }), null, "at the instant: still open");
  assert.equal(
    editable({ now: new Date(GOAL_SETTING.deadline.getTime() + 1000) }),
    "The goal-setting deadline has passed and the stage is locked.",
  );
});

test("§5.4 the lock does not soften, and the grace window does not reopen it", () => {
  const insideGrace = new Date("2027-01-02T00:00:00Z"); // graceDays: 3
  const longAfter = new Date("2027-06-01T00:00:00Z");
  assert.equal(
    editable({ now: insideGrace }),
    "The goal-setting deadline has passed and the stage is locked.",
    "grace gates HR's intervention, never the ability to act",
  );
  assert.equal(editable({ now: longAfter }), editable({ now: insideGrace }));
});

test("§5.4 HR does not get to act inside a locked stage either", () => {
  assert.equal(
    editable({
      actor: actor({ userId: "u-hr", employeeId: "hr-1", pmsRoles: ["HRBP"] }),
      now: AFTER,
    }),
    "The goal-setting deadline has passed and the stage is locked.",
    "§5.5 gives HR an extension — which moves the deadline and leaves a trail — not a bypass",
  );
});

test("§2 a stage that has not opened refuses with a different sentence than a locked one", () => {
  assert.equal(
    editable({ now: new Date("2026-11-30T23:59:59Z") }),
    "Goal-setting has not opened yet for this cycle.",
    "'not yet' and 'too late' are different problems and must not share a message",
  );
});

// --- §4.2 the direct line manager, and only them ----------------------------

test("§4.2 a report two levels down is view-only, and the refusal says why", () => {
  assert.equal(
    editable({ target: SKIP_LEVEL_REPORT }),
    "Only this employee's direct line manager may draft their KPIs.",
    "US-10: chain visibility is not chain authority — one owner per assessment",
  );
});

test("§4.2 the §4.2 check runs FIRST, so a stranger never learns the stage state", () => {
  // A locked stage plus a non-report must report the authority problem, not the
  // timing one: the ordering is what stops an actor probing deadlines for
  // employees they have no business acting on.
  assert.equal(
    editable({ target: SKIP_LEVEL_REPORT, now: AFTER }),
    "Only this employee's direct line manager may draft their KPIs.",
  );
});

test("§4.2 authority follows the managerId edge, not a role or a title", () => {
  assert.equal(editable({ target: { id: "emp-3", managerId: "mgr-1" } }), null);
  assert.equal(
    editable({ actor: actor({ employeeId: "mgr-2" }) }),
    "Only this employee's direct line manager may draft their KPIs.",
    "a peer manager is a stranger to this employee's set",
  );
});

test("§4.1 HR overrides §4.2 — an executive viewer does not", () => {
  assert.equal(
    editable({
      actor: actor({ userId: "u-hr", employeeId: "hr-1", pmsRoles: ["HR_SUPER_ADMIN"] }),
      target: SKIP_LEVEL_REPORT,
    }),
    null,
    "§4.1 grants HR 'everything + overrides'",
  );
  assert.equal(
    editable({
      actor: actor({ userId: "u-coo", employeeId: "coo-1", pmsRoles: ["EXECUTIVE_VIEWER"] }),
      target: SKIP_LEVEL_REPORT,
    }),
    "Only this employee's direct line manager may draft their KPIs.",
    "§4.1 pins the COO to 'Acts on: Nothing' — org-wide sight, no authority",
  );
});

test("§4.2 an actor with no employee record has no drafting authority at all", () => {
  assert.equal(
    editable({ actor: actor({ userId: "u-admin", employeeId: null, isLineManager: false }) }),
    "Only this employee's direct line manager may draft their KPIs.",
    "a platform ADMIN with no employee row is not a line manager (ADR-065)",
  );
});

// --- §8.3 C-Level are exempt ------------------------------------------------

test("§8.3 C-Level skip goal-setting entirely; every other track does not", () => {
  // The exemption is a property of the TRACK, checked by the route before the
  // edit gate is consulted at all — there is no KPI set for a C-Level employee,
  // so the refusal is categorical rather than a timing or authority answer.
  assert.equal(isGoalSettingExempt("C_LEVEL"), true);
  for (const track of ["DIRECTOR", "MANAGER", "LEAD", "INDIVIDUAL"] as const) {
    assert.equal(isGoalSettingExempt(track), false, `${track} still sets goals`);
  }
});

test("§8.3 the exemption is about the WORK, not the enrolment", () => {
  // A C-Level participant is still enrolled (§11 reporting and the entity score
  // pass-through both need the row), so the edit gate would happily say "yes" for
  // a C-Level direct report of the CEO. That is why §8.3 is enforced ahead of it
  // rather than expected to fall out of it.
  assert.equal(
    editable({ target: { id: "clevel-1", managerId: "mgr-1" } }),
    null,
    "kpiEditBlockedReason knows nothing about role tracks — the route must check §8.3 itself",
  );
});

// --- the shared seam --------------------------------------------------------

test("KPI drafting and goal sign-off name the same stage", () => {
  assert.equal(GOAL_SETTING_STAGE, "GOAL_SETTING");
});

test("QA2 D-15 an employee drafting their OWN KPIs is refused with 403 (authority), not 409 (state)", () => {
  const params = {
    visible: true,
    employee: { id: "emp-1", managerId: "mgr-1", roleTrack: "INDIVIDUAL" as const },
    cycleStatus: "OPEN",
    stage: GOAL_SETTING,
    goalsApprovedAt: null,
    now: DURING,
  };
  const self = kpiSetAccessRefusal({
    ...params,
    actor: actor({ employeeId: "emp-1", isLineManager: false }),
  });
  assert.equal(self?.status, 403);
  assert.equal(self?.reason, "Only this employee's direct line manager may draft their KPIs.");
  const late = kpiSetAccessRefusal({ ...params, actor: actor(), now: AFTER });
  assert.equal(late?.status, 409, "a locked stage is still a state refusal");
});
