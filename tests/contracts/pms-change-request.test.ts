import test from "node:test";
import assert from "node:assert/strict";

import { Prisma } from "../../generated/prisma/client";
import {
  EDITABLE_FIELDS,
  applyEdit,
  approvalBlockedReason,
  changeRequestAccessRefusal,
  decideBlockedReason,
  fieldChanges,
  proposedWeightageTotal,
  submitBlockedReason,
  withdrawBlockedReason,
  type KpiEdit,
  type KpiState,
} from "../../lib/pms/change-request";
import type { StageWindow } from "../../lib/pms/cycle";
import type { PmsActor } from "../../lib/pms/permissions";

/**
 * §6 — mid-year change requests.
 *
 * The load-bearing assertion in this file is that **approval cannot leave the
 * set off 100%**. §6.2 speaks of changing "a KPI", but §5.3 requires the set to
 * total exactly 100 and mid-year has no sign-off to catch a violation — so if
 * this rule is wrong, an HR-approved baseline can sit invalid for months and
 * nothing downstream notices until Phase 5 tries to score it.
 */

const kpi = (id: string, weightage: string, over: Partial<KpiState> = {}): KpiState => ({
  id,
  description: `KPI ${id}`,
  weightage: new Prisma.Decimal(weightage),
  descriptorOutstanding: "o",
  descriptorExcellent: "e",
  descriptorTarget: "t",
  descriptorAlmostAchieved: "a",
  descriptorUnsatisfactory: "u",
  ...over,
});

const SET = [kpi("k1", "40"), kpi("k2", "35"), kpi("k3", "25")]; // = 100

const actor = (over: Partial<PmsActor> = {}): PmsActor => ({
  userId: "u1",
  employeeId: "mgr",
  pmsRoles: [],
  isLineManager: true,
  ...over,
});
const hr = actor({ employeeId: "hr", pmsRoles: ["HR_SUPER_ADMIN"], isLineManager: false });
const report = { id: "emp", managerId: "mgr" };

const MID_YEAR: StageWindow = {
  kind: "MID_YEAR",
  opensAt: new Date("2027-06-01T00:00:00Z"),
  deadline: new Date("2027-07-15T00:00:00Z"),
  graceDays: 5,
};
const DURING = new Date("2027-06-20T00:00:00Z");
const AFTER = new Date("2027-08-01T00:00:00Z");
const APPROVED = new Date("2026-12-20T00:00:00Z");

// --- §6.2 a partial change leaves everything else alone ----------------------

test("§6.2 an absent field means UNCHANGED — that is what a partial change is", () => {
  const edited = applyEdit(kpi("k1", "40"), { kpiId: "k1", descriptorTarget: "Reworded" });
  assert.equal(edited.descriptorTarget, "Reworded");
  assert.equal(edited.description, "KPI k1", "description untouched");
  assert.equal(edited.weightage.toString(), "40", "weightage untouched");
  assert.equal(edited.descriptorOutstanding, "o");
});

test("§6.2 an explicit null also means unchanged, not blanked", () => {
  // The wire shape allows null; treating it as "set to null" would silently
  // erase one of §5.2's six required texts.
  const edited = applyEdit(kpi("k1", "40"), { kpiId: "k1", description: null, weightage: null });
  assert.equal(edited.description, "KPI k1");
  assert.equal(edited.weightage.toString(), "40");
});

test("§6.2 a full overhaul replaces all seven fields", () => {
  const edit: KpiEdit = {
    kpiId: "k1",
    description: "New",
    weightage: "55",
    descriptorOutstanding: "O",
    descriptorExcellent: "E",
    descriptorTarget: "T",
    descriptorAlmostAchieved: "A",
    descriptorUnsatisfactory: "U",
  };
  const edited = applyEdit(kpi("k1", "40"), edit);
  for (const field of EDITABLE_FIELDS) {
    assert.notEqual(String(edited[field]), String(kpi("k1", "40")[field]), `${field} changed`);
  }
});

test("a KPI with no edit in the request passes through untouched", () => {
  assert.deepEqual(applyEdit(SET[1], undefined), SET[1]);
});

// --- §5.3 the rule the whole design turns on ---------------------------------

test("§5.3 approving a single-weightage change that unbalances the set is REFUSED", () => {
  // The exact scenario that makes one-KPI-per-request wrong: 40 -> 30 leaves 90.
  const reason = approvalBlockedReason({
    kpis: SET,
    edits: [{ kpiId: "k1", weightage: "30" }],
  });
  assert.ok(reason, "must not be approvable");
  assert.match(reason as string, /90%/);
  assert.match(reason as string, /10%.*short/);
  assert.match(reason as string, /one request/i, "and it should say how to fix it");
});

test("§5.3 the same change REBALANCED in one request is approvable", () => {
  assert.equal(
    approvalBlockedReason({
      kpis: SET,
      edits: [
        { kpiId: "k1", weightage: "30" },
        { kpiId: "k2", weightage: "45" },
      ],
    }),
    null,
  );
});

test("§5.3 going OVER 100 is refused too, and says so", () => {
  const reason = approvalBlockedReason({ kpis: SET, edits: [{ kpiId: "k1", weightage: "60" }] });
  assert.match(reason as string, /120%/);
  assert.match(reason as string, /20%.*over/);
});

test("§5.3 the check is exact decimal arithmetic, not floating point", () => {
  const thirds = [kpi("a", "33.33"), kpi("b", "33.33"), kpi("c", "33.34")];
  assert.equal(approvalBlockedReason({ kpis: thirds, edits: [] }), null, "99.99+0.01 lands on 100");
  assert.equal(
    proposedWeightageTotal([kpi("a", "0.1"), kpi("b", "0.2")], []).toString(),
    "0.3",
    "0.1 + 0.2 is 0.3 here, which IEEE-754 cannot promise",
  );
});

test("a descriptor-only change never touches the total", () => {
  assert.equal(
    approvalBlockedReason({ kpis: SET, edits: [{ kpiId: "k1", descriptorTarget: "Reworded" }] }),
    null,
  );
});

test("an edit naming a KPI that has since left the set is refused, not silently dropped", () => {
  // Withdrawn between raising and deciding. Applying the rest would approve
  // something other than what the manager asked for.
  const reason = approvalBlockedReason({ kpis: SET, edits: [{ kpiId: "gone", weightage: "10" }] });
  assert.match(reason as string, /no longer in the set/i);
  assert.match(reason as string, /reject/i, "it should say what HR can do about it");
});

// --- §4.2 / §5.4 / §5.1 who may submit ---------------------------------------

test("§4.2 only the direct line manager may raise a request; a stranger gets 404", () => {
  const refusal = submitBlockedReason({
    actor: actor(),
    target: { id: "emp", managerId: "someone-else" },
    stage: MID_YEAR,
    now: DURING,
    goalsApprovedAt: APPROVED,
  });
  assert.equal(refusal?.status, 404, "404, not 403 — no existence oracle (§4.2)");
});

test("§4.1 HR may raise one on anyone", () => {
  assert.equal(
    submitBlockedReason({
      actor: hr,
      target: report,
      stage: MID_YEAR,
      now: DURING,
      goalsApprovedAt: APPROVED,
    }),
    null,
  );
});

test("§5.1 there is nothing to change before HR has approved a baseline", () => {
  const refusal = submitBlockedReason({
    actor: actor(),
    target: report,
    stage: MID_YEAR,
    now: DURING,
    goalsApprovedAt: null,
  });
  assert.equal(refusal?.status, 409);
  assert.match(refusal?.reason as string, /no HR-approved baseline/i);
  assert.match(refusal?.reason as string, /goal-setting/i, "and it should say where they are");
});

test("§5.4 the mid-year deadline locks the manager out, and says which lock it was", () => {
  const late = submitBlockedReason({
    actor: actor(),
    target: report,
    stage: MID_YEAR,
    now: AFTER,
    goalsApprovedAt: APPROVED,
  });
  assert.match(late?.reason as string, /deadline has passed/i);

  const early = submitBlockedReason({
    actor: actor(),
    target: report,
    stage: MID_YEAR,
    now: new Date("2027-01-01T00:00:00Z"),
    goalsApprovedAt: APPROVED,
  });
  assert.match(early?.reason as string, /has not opened/i);
});

test("a cycle with no mid-year stage configured refuses clearly", () => {
  const refusal = submitBlockedReason({
    actor: actor(),
    target: report,
    stage: null,
    now: DURING,
    goalsApprovedAt: APPROVED,
  });
  assert.match(refusal?.reason as string, /no mid-year stage/i);
});

// --- §6.2 who decides --------------------------------------------------------

test("§6.2 only HR decides — a line manager cannot approve their own request", () => {
  const refusal = decideBlockedReason({ actor: actor(), status: "PENDING" });
  assert.equal(refusal?.status, 403);
  assert.match(refusal?.reason as string, /Only HR/i);
  assert.equal(decideBlockedReason({ actor: hr, status: "PENDING" }), null);
});

test("§6.2 a request is decided once", () => {
  for (const status of ["APPROVED", "REJECTED", "WITHDRAWN"] as const) {
    const refusal = decideBlockedReason({ actor: hr, status });
    assert.equal(refusal?.status, 409, `${status} is not re-decidable`);
    assert.match(refusal?.reason as string, new RegExp(status.toLowerCase()));
  }
});

test("HR deciding is NOT blocked by the stage deadline", () => {
  // §5.4 locks out the party who owns the action. HR owns the cycle, and a
  // request left pending past the deadline still has to be resolvable —
  // otherwise it sits PENDING for ever and §6.3 records a question with no
  // answer. `decideBlockedReason` deliberately takes no clock.
  assert.equal(decideBlockedReason({ actor: hr, status: "PENDING" }), null);
});

// --- withdrawal is a status, never a delete ----------------------------------

test("the requester may withdraw their own pending request; a stranger gets 404", () => {
  assert.equal(
    withdrawBlockedReason({ actor: actor(), requestedByEmployeeId: "mgr", status: "PENDING" }),
    null,
  );
  assert.equal(
    withdrawBlockedReason({ actor: actor(), requestedByEmployeeId: "other", status: "PENDING" })
      ?.status,
    404,
  );
  assert.equal(
    withdrawBlockedReason({ actor: hr, requestedByEmployeeId: "other", status: "PENDING" }),
    null,
    "HR may withdraw on the manager's behalf",
  );
});

test("a decided request cannot be withdrawn afterwards", () => {
  assert.equal(
    withdrawBlockedReason({ actor: actor(), requestedByEmployeeId: "mgr", status: "APPROVED" })
      ?.status,
    409,
  );
});

test("an unlinked account withdraws nothing", () => {
  assert.equal(
    withdrawBlockedReason({
      actor: actor({ employeeId: null }),
      requestedByEmployeeId: "mgr",
      status: "PENDING",
    })?.status,
    404,
  );
});

// --- §6.3 what changed -------------------------------------------------------

test("§6.3 the history names every field that moved, and none that did not", () => {
  const before = kpi("k1", "40");
  const after = applyEdit(before, { kpiId: "k1", weightage: "30", descriptorTarget: "Reworded" });
  const changes = fieldChanges(before, after);

  assert.deepEqual(Object.keys(changes).sort(), ["descriptorTarget", "weightage"]);
  assert.deepEqual(changes.weightage, { from: "40", to: "30" });
  assert.deepEqual(changes.descriptorTarget, { from: "t", to: "Reworded" });
});

test("§6.3 an unchanged KPI produces an empty change set, not a noisy one", () => {
  assert.deepEqual(fieldChanges(SET[0], SET[0]), {});
});

test("§6.3 a weightage rewritten to the same number is not a change", () => {
  // `1.50` and `1.5` are the same weightage; reporting that as a change would
  // accuse a manager of an edit they did not make.
  const before = kpi("k1", "1.5");
  const after = applyEdit(before, { kpiId: "k1", weightage: new Prisma.Decimal("1.50") });
  assert.deepEqual(fieldChanges(before, after), {});
});

// --- the full gate, in the order a person would ask it -----------------------

type GateParams = Parameters<typeof changeRequestAccessRefusal>[0];

const gate = (over: Partial<GateParams> = {}) =>
  changeRequestAccessRefusal({
    actor: actor(),
    visible: true,
    employee: { id: "emp", managerId: "mgr", roleTrack: "INDIVIDUAL" },
    cycleStatus: "OPEN",
    stage: MID_YEAR,
    goalsApprovedAt: APPROVED,
    now: DURING,
    ...over,
  });

test("the gate lets a line manager through on an open cycle in the mid-year window", () => {
  assert.equal(gate(), null);
});

test("§4.2 invisibility answers FIRST, before anything about the participant's state", () => {
  // Ordering is the assertion. If §8.3 or the cycle status answered first, the
  // 409 sentence would tell a stranger that the participant exists and what
  // role track they are on.
  const refusal = gate({
    visible: false,
    employee: { id: "emp", managerId: "mgr", roleTrack: "C_LEVEL" },
    cycleStatus: "CLOSED",
  });
  assert.equal(refusal?.status, 404);
  assert.equal(refusal?.reason, "Participant not found");
});

test("§8.3 C-Level have no baseline to change", () => {
  const refusal = gate({ employee: { id: "emp", managerId: "mgr", roleTrack: "C_LEVEL" } });
  assert.equal(refusal?.status, 409);
  assert.match(refusal?.reason as string, /C-Level/);
  assert.match(refusal?.reason as string, /§8\.3/);
});

test("§2 a cycle that is not running takes no change requests, and says which state it is in", () => {
  for (const status of ["DRAFT", "CLOSED"]) {
    const refusal = gate({ cycleStatus: status });
    assert.equal(refusal?.status, 409);
    assert.match(refusal?.reason as string, new RegExp(status));
  }
});

test("the gate still applies §5.1 and §5.4 rather than stopping at the cycle status", () => {
  assert.match(gate({ goalsApprovedAt: null })?.reason as string, /no HR-approved baseline/i);
  assert.match(gate({ now: AFTER })?.reason as string, /deadline has passed/i);
});
