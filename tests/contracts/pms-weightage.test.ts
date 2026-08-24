import test from "node:test";
import assert from "node:assert/strict";

import {
  KPI_LEVELS,
  REQUIRED_TOTAL,
  isWeightageComplete,
  kpiEditBlockedReason,
  signOffBlockedReason,
  weightageGap,
  weightageMessage,
  weightageTotal,
} from "../../lib/pms/kpi";
import type { StageWindow } from "../../lib/pms/cycle";
import type { PmsActor } from "../../lib/pms/permissions";
import { kpiInputSchema, updateKpiSchema } from "../../lib/validations/kpi";

/**
 * §5.3's exactly-100% rule and §5.1/§5.4's edit locks.
 *
 * These live apart from the KPI route tests because the rule is the seam three
 * callers share — the drafting UI's live total, the sign-off route, and HR's
 * approval. If they ever disagree about what 100% means, it starts here.
 */

const kpis = (...weights: (string | number)[]) => weights.map((weightage) => ({ weightage }));

const STAGE: StageWindow = {
  kind: "GOAL_SETTING",
  opensAt: new Date("2026-12-01T00:00:00Z"),
  deadline: new Date("2026-12-31T23:59:59Z"),
  graceDays: 3,
};
const DURING = new Date("2026-12-15T00:00:00Z");
const AFTER = new Date("2027-01-05T00:00:00Z");

const actor = (over: Partial<PmsActor> = {}): PmsActor => ({
  userId: "u1",
  employeeId: "mgr",
  pmsRoles: [],
  isLineManager: true,
  ...over,
});
const report = { id: "emp", managerId: "mgr" };

// --- §5.2 the five levels ---------------------------------------------------

test("§5.2 there are exactly five levels, valued 5 down to 1", () => {
  assert.equal(KPI_LEVELS.length, 5);
  assert.deepEqual(
    KPI_LEVELS.map((l) => [l.label, l.value]),
    [
      ["Outstanding", 5],
      ["Excellent", 4],
      ["Target", 3],
      ["Almost Achieved", 2],
      ["Unsatisfactory", 1],
    ],
  );
});

// --- §5.3 exactly 100 -------------------------------------------------------

test("§5.3 a set totalling exactly 100 is complete", () => {
  assert.equal(isWeightageComplete(kpis(40, 35, 25)), true);
  assert.equal(weightageTotal(kpis(40, 35, 25)).toString(), "100");
  assert.equal(weightageMessage(kpis(40, 35, 25)), null, "nothing to say when it is right");
});

test("§5.3 99.99 and 100.01 both fail — there is no tolerance", () => {
  assert.equal(isWeightageComplete(kpis("33.33", "33.33", "33.33")), false, "99.99 is not 100");
  assert.equal(isWeightageComplete(kpis("33.34", "33.34", "33.33")), false, "100.01 is not 100");
  assert.equal(isWeightageComplete(kpis("33.34", "33.33", "33.33")), true, "100.00 is");
});

test("§5.3 the total is exact decimal arithmetic, not floating point", () => {
  // 0.1 + 0.2 !== 0.3 in IEEE-754. A weightage rule that compares against
  // exactly 100 cannot be built on that.
  assert.equal(weightageTotal(kpis("0.1", "0.2")).toString(), "0.3");
  assert.equal(
    isWeightageComplete(kpis("99.7", "0.1", "0.2")),
    true,
    "a set that sums to 100 in decimal must be signable",
  );
});

test("§5.3 the message names the gap, because a manager has to fix it", () => {
  const short = weightageMessage(kpis(40, 35, 20));
  assert.ok(short?.includes("95"), `expected the total: ${short}`);
  assert.ok(short?.includes("5"), `expected the shortfall: ${short}`);
  assert.match(short as string, /short/i);

  const over = weightageMessage(kpis(60, 60));
  assert.match(over as string, /over/i);
  assert.ok(over?.includes("120"));
});

test("§5.1 an empty set is not signable, and says why", () => {
  assert.equal(isWeightageComplete([]), false);
  assert.match(weightageMessage([]) as string, /no KPIs yet/i);
});

test("the gap is signed: negative short, positive over, zero exact", () => {
  assert.ok(weightageGap(kpis(90)).isNegative());
  assert.ok(weightageGap(kpis(110)).isPositive());
  assert.ok(weightageGap(kpis(100)).isZero());
  assert.equal(REQUIRED_TOTAL.toString(), "100");
});

// --- §4.2 / §5.4 / §5.1 the three edit gates --------------------------------

test("§4.2 only the direct line manager may draft; a deeper chain is view-only", () => {
  const notMine = { id: "emp", managerId: "someone-else" };
  assert.match(
    kpiEditBlockedReason({
      actor: actor(),
      target: notMine,
      stage: STAGE,
      now: DURING,
      goalsApprovedAt: null,
    }) as string,
    /direct line manager/i,
  );
  assert.equal(
    kpiEditBlockedReason({
      actor: actor(),
      target: report,
      stage: STAGE,
      now: DURING,
      goalsApprovedAt: null,
    }),
    null,
    "their own direct report is fine",
  );
});

test("§4.1 HR overrides the direct-report rule", () => {
  const hr = actor({ employeeId: "hr", pmsRoles: ["HR_SUPER_ADMIN"], isLineManager: false });
  assert.equal(
    kpiEditBlockedReason({
      actor: hr,
      target: report,
      stage: STAGE,
      now: DURING,
      goalsApprovedAt: null,
    }),
    null,
  );
});

test("§5.4 a locked stage blocks the edit, and says which lock it was", () => {
  const reason = kpiEditBlockedReason({
    actor: actor(),
    target: report,
    stage: STAGE,
    now: AFTER,
    goalsApprovedAt: null,
  });
  assert.match(reason as string, /deadline has passed/i);

  const early = kpiEditBlockedReason({
    actor: actor(),
    target: report,
    stage: STAGE,
    now: new Date("2026-11-01T00:00:00Z"),
    goalsApprovedAt: null,
  });
  assert.match(early as string, /has not opened/i);
});

test("§5.1 HR approval is the lock — an approved set refuses edits inside an open stage", () => {
  const reason = kpiEditBlockedReason({
    actor: actor(),
    target: report,
    stage: STAGE,
    now: DURING,
    goalsApprovedAt: new Date("2026-12-20T00:00:00Z"),
  });
  assert.match(reason as string, /approved/i);
  assert.match(
    reason as string,
    /change request/i,
    "it should point at the correction path (§6.2)",
  );
});

test("the three gates are reported in the order a person would ask them", () => {
  // Wrong manager AND locked AND approved: the answer should be the first
  // question, not the last. "It's not your report" is the useful one.
  const reason = kpiEditBlockedReason({
    actor: actor(),
    target: { id: "emp", managerId: "someone-else" },
    stage: STAGE,
    now: AFTER,
    goalsApprovedAt: new Date("2026-12-20T00:00:00Z"),
  });
  assert.match(reason as string, /direct line manager/i);
});

// --- sign-off has the stage lock but NOT the approval lock ------------------

test("§5.3 sign-off is refused on an incomplete set, with the gap named", () => {
  assert.match(
    signOffBlockedReason({ kpis: kpis(40, 35), stage: STAGE, now: DURING }) as string,
    /short/i,
  );
  assert.equal(signOffBlockedReason({ kpis: kpis(40, 35, 25), stage: STAGE, now: DURING }), null);
});

test("§5.4 sign-off is refused after the deadline even at exactly 100%", () => {
  assert.match(
    signOffBlockedReason({ kpis: kpis(100), stage: STAGE, now: AFTER }) as string,
    /locked/i,
  );
});

// --- the update schema must not carry create's defaults ---------------------
//
// Found in review of Phase 2b. `z.object({...}).partial()` does NOT strip a
// `.default()`, so building the update schema from the create shape produced
// `{ orderIndex: 0 }` out of an EMPTY body — which meant editing a KPI's wording
// silently moved it to the top of the manager's list, and the "Nothing to
// update" guard could never fire.

test("an empty update body is rejected, not silently defaulted", () => {
  const parsed = updateKpiSchema.safeParse({});
  assert.equal(parsed.success, false, "{} carries no intent and must not parse");
  if (!parsed.success) {
    assert.match(parsed.error.issues[0].message, /Nothing to update/);
  }
});

test("a partial update does not resurrect a default and reorder the list", () => {
  const parsed = updateKpiSchema.safeParse({ description: "reworded, same position" });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.deepEqual(
      Object.keys(parsed.data),
      ["description"],
      "an omitted orderIndex must stay omitted — the KPI keeps its place",
    );
  }
});

test("create still defaults orderIndex, because a new KPI needs a position", () => {
  const parsed = kpiInputSchema.safeParse({
    description: "Ship it",
    weightage: 40,
    descriptorOutstanding: "a",
    descriptorExcellent: "b",
    descriptorTarget: "c",
    descriptorAlmostAchieved: "d",
    descriptorUnsatisfactory: "e",
  });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.orderIndex, 0);
});
