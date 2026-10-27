import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { Prisma } from "../../generated/prisma/client";
import {
  EDITABLE_FIELDS,
  applyEdit,
  approvalBlockedReason,
  changeRequestAccessRefusal,
  decideBlockedReason,
  acknowledgeBlockedReason,
  effectiveChangeRequestStatus,
  approvalAcknowledgmentReason,
  fieldChanges,
  proposedWeightageTotal,
  stageReopensUnacknowledged,
  submitBlockedReason,
  withdrawBlockedReason,
  type KpiEdit,
  type KpiState,
} from "../../lib/pms/change-request";
import type { StageWindow } from "../../lib/pms/cycle";
import type { PmsActor } from "../../lib/pms/permissions";
import { decideChangeRequestSchema } from "../../lib/validations/change-request";

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
  assert.equal(refusal?.status, 404, "404, not 403 — no existence oracle");
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
  assert.match(refusal?.reason as string, /C-Level/);
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

// --- UAT Scenario C — the employee acknowledges before HR decides ------------
//
// The spec change that introduced these rules replaced "manager asks, HR
// decides, employee is never involved". The load-bearing assertion here is the
// mirror of the one at the top of this file: an UNACKNOWLEDGED request must
// never be able to change a KPI once the mid-year deadline has passed. If that
// rule is wrong, a manager can push a change through simply by waiting — which
// is the one thing §6.2's new flow exists to prevent.

const employee = actor({ employeeId: "emp", isLineManager: false });
const chainManager = actor({ employeeId: "skip", isLineManager: true });

test("§6.2 only the employee may acknowledge their own request", () => {
  assert.equal(
    acknowledgeBlockedReason({
      actor: employee,
      subjectEmployeeId: "emp",
      status: "PENDING",
      acknowledgedAt: null,
      stage: MID_YEAR,
      now: DURING,
    }),
    null,
  );
});

test("§6.2 a manager cannot acknowledge on their report's behalf", () => {
  const blocked = acknowledgeBlockedReason({
    actor: actor(), // the line manager who raised it
    subjectEmployeeId: "emp",
    status: "PENDING",
    acknowledgedAt: null,
    stage: MID_YEAR,
    now: DURING,
  });
  assert.equal(blocked?.status, 403);
  assert.match(String(blocked?.reason), /only the employee/i);
});

test("§4.1 not even HR may acknowledge for the employee — HR has the override instead", () => {
  const blocked = acknowledgeBlockedReason({
    actor: hr,
    subjectEmployeeId: "emp",
    status: "PENDING",
    acknowledgedAt: null,
    stage: MID_YEAR,
    now: DURING,
  });
  assert.equal(blocked?.status, 403);
});

test("§4.2 a view-only chain manager cannot acknowledge", () => {
  const blocked = acknowledgeBlockedReason({
    actor: chainManager,
    subjectEmployeeId: "emp",
    status: "PENDING",
    acknowledgedAt: null,
    stage: MID_YEAR,
    now: DURING,
  });
  assert.equal(blocked?.status, 403);
});

test("§6.2 acknowledgment happens once", () => {
  const blocked = acknowledgeBlockedReason({
    actor: employee,
    subjectEmployeeId: "emp",
    status: "PENDING",
    acknowledgedAt: new Date("2027-06-21T00:00:00Z"),
    stage: MID_YEAR,
    now: DURING,
  });
  assert.equal(blocked?.status, 409);
});

test("§6.2 there is nothing to acknowledge on a request already decided", () => {
  for (const status of ["APPROVED", "REJECTED", "WITHDRAWN"] as const) {
    const blocked = acknowledgeBlockedReason({
      actor: employee,
      subjectEmployeeId: "emp",
      status,
      acknowledgedAt: null,
      stage: MID_YEAR,
      now: DURING,
    });
    assert.equal(blocked?.status, 409, status);
  }
});

test("§5.4 the deadline locks acknowledgment too — it is a hard lock, not a nudge", () => {
  const blocked = acknowledgeBlockedReason({
    actor: employee,
    subjectEmployeeId: "emp",
    status: "PENDING",
    acknowledgedAt: null,
    stage: MID_YEAR,
    now: AFTER,
  });
  assert.equal(blocked?.status, 409);
  assert.match(String(blocked?.reason), /deadline/i);
});

// --- the derived lock --------------------------------------------------------

test("an unacknowledged request past the deadline READS as NOT_ACKNOWLEDGED", () => {
  assert.equal(
    effectiveChangeRequestStatus({
      status: "PENDING",
      acknowledgedAt: null,
      stage: MID_YEAR,
      now: AFTER,
    }),
    "NOT_ACKNOWLEDGED",
  );
});

test("the derived lock never rewrites a status that was actually decided", () => {
  for (const status of ["APPROVED", "REJECTED", "WITHDRAWN"] as const) {
    assert.equal(
      effectiveChangeRequestStatus({ status, acknowledgedAt: null, stage: MID_YEAR, now: AFTER }),
      status,
      status,
    );
  }
});

test("an acknowledged request past the deadline is still PENDING for HR to decide", () => {
  assert.equal(
    effectiveChangeRequestStatus({
      status: "PENDING",
      acknowledgedAt: new Date("2027-06-21T00:00:00Z"),
      stage: MID_YEAR,
      now: AFTER,
    }),
    "PENDING",
  );
});

// --- the approval gate + HR's override ---------------------------------------

test("§6.2 an acknowledged request needs no override reason", () => {
  assert.equal(
    approvalAcknowledgmentReason({
      acknowledgedAt: new Date("2027-06-21T00:00:00Z"),
      overrideReason: null,
      stage: MID_YEAR,
      now: DURING,
    }),
    null,
  );
});

test("§6.2 approving an UNACKNOWLEDGED request without a reason is refused", () => {
  const refusal = approvalAcknowledgmentReason({
    acknowledgedAt: null,
    overrideReason: null,
    stage: MID_YEAR,
    now: DURING,
  });
  assert.match(String(refusal), /acknowledg/i);
});

test("a blank override reason is not a reason", () => {
  for (const blank of ["", "   ", "\n\t"]) {
    assert.ok(
      approvalAcknowledgmentReason({
        acknowledgedAt: null,
        overrideReason: blank,
        stage: MID_YEAR,
        now: DURING,
      }),
      JSON.stringify(blank),
    );
  }
});

test("§6.2 HR MAY override an unacknowledged request, with a reason, while the stage is open", () => {
  assert.equal(
    approvalAcknowledgmentReason({
      acknowledgedAt: null,
      overrideReason: "Employee on extended medical leave; change agreed with their director.",
      stage: MID_YEAR,
      now: DURING,
    }),
    null,
  );
});

test("§5.4 after the deadline NOT EVEN an override approves it — no acknowledgment, no change", () => {
  const refusal = approvalAcknowledgmentReason({
    acknowledgedAt: null,
    overrideReason: "We really do want this one.",
    stage: MID_YEAR,
    now: AFTER,
  });
  assert.match(String(refusal), /deadline|did not acknowledge/i);
});

test("an acknowledged request is still approvable after the deadline — HR owns the cycle", () => {
  assert.equal(
    approvalAcknowledgmentReason({
      acknowledgedAt: new Date("2027-06-21T00:00:00Z"),
      overrideReason: null,
      stage: MID_YEAR,
      now: AFTER,
    }),
    null,
  );
});

// --- the boundary, where HR's override is typed ------------------------------

test("§6.2 the override reason is its own field, not a second meaning for `reason`", () => {
  const ok = decideChangeRequestSchema.safeParse({
    decision: "APPROVE",
    overrideReason: "Employee on extended leave; agreed with their director.",
  });
  assert.equal(ok.success, true);
  if (ok.success) assert.equal(ok.data.reason, undefined);
});

test("§6.2 a rejection still demands its own reason, unchanged by the new field", () => {
  const missing = decideChangeRequestSchema.safeParse({ decision: "REJECT" });
  assert.equal(missing.success, false);
});

test("a rejection changes nothing, so it cannot carry an override", () => {
  const nonsense = decideChangeRequestSchema.safeParse({
    decision: "REJECT",
    reason: "Not this year.",
    overrideReason: "Overriding a rejection is not a thing.",
  });
  assert.equal(nonsense.success, false);
});

// --- the override may not outrun the acknowledgment --------------------------

test("§6.2 an override approval is claimed against the acknowledgment, not just the status", () => {
  // Source-level, like the policy-consumer guard, and for the same reason: the
  // failure is neither a type error nor a throw in any pure function.
  //
  // `overriding` is derived from a read taken BEFORE the decide transaction
  // opens. The employee acknowledging in that window is not a far-fetched
  // interleaving — it is two people on two screens, which is the ordinary case
  // this flow was built for. A claim predicated on `status: "PENDING"` alone
  // would then stamp `acknowledgmentOverridden: true` onto a request that WAS
  // acknowledged: a false row in the one history §6.2 exists to keep honest.
  //
  // `kpi_change_requests_override_excludes_ack_check` refuses that row at the
  // database, so the record cannot actually lie — but without the predicate the
  // race reaches HR as a 500 instead of "reload, they just acknowledged", and
  // the correctness of the whole path would rest on a CHECK constraint named in
  // a migration rather than on the claim that performs the write.
  const src = readFileSync("app/api/kpi-change-requests/[id]/decide/route.ts", "utf8");
  const approvalClaim = src.slice(src.indexOf('status: "APPROVED"') - 600);
  assert.ok(
    /acknowledgedAt:\s*overriding\s*\?\s*null\s*:\s*\{\s*not:\s*null\s*\}/.test(approvalClaim),
    "the approval claim must constrain acknowledgedAt to the state the consent gate was " +
      "evaluated against, or an override can land on a request the employee acknowledged",
  );
});

// --- §5.5 × §6.2 — extending a deadline takes the lock back ------------------
//
// ADR-072 decision 3, option A (operator's choice, 2026-10-19). The defect this
// closes is not that a locked request stays locked — it is that it stayed locked
// or did not depending on whether the overnight sweep had run, so HR's §5.5
// remedy behaved differently at 9pm and at 9am for the same act.

test("§5.5 extending the mid-year deadline into the future reopens the lock", () => {
  // The same window, re-opened: `now` is inside it again.
  assert.equal(stageReopensUnacknowledged({ stage: MID_YEAR, now: DURING }), true);
});

test("§5.5 a deadline still in the past reopens nothing", () => {
  // HR edited the stage but did not actually extend past `now` — the lock holds.
  assert.equal(stageReopensUnacknowledged({ stage: MID_YEAR, now: AFTER }), false);
});

test("§5.5 a window pushed wholesale into the FUTURE does not reopen either", () => {
  // The trap in reading this as "deadline > now": a stage that has not opened
  // yet has a future deadline too, and nobody can acknowledge inside it. The
  // predicate asks for OPEN, which is the state in which acknowledging works.
  const notYetOpen = new Date("2027-05-01T00:00:00Z");
  assert.equal(stageReopensUnacknowledged({ stage: MID_YEAR, now: notYetOpen }), false);
});

test("§5.5 moving a goal-setting or year-end deadline never touches §6.2's lock", () => {
  // Only the MID_YEAR deadline is what locks a change request, so only moving
  // THAT one can unlock one. A PUT carries up to three stages at once and the
  // other two must not reach across.
  for (const kind of ["GOAL_SETTING", "YEAR_END"] as const) {
    assert.equal(
      stageReopensUnacknowledged({ stage: { ...MID_YEAR, kind }, now: DURING }),
      false,
      `${kind} must not reopen a mid-year change request`,
    );
  }
});

test("reopening is confined to what the CLOCK closed, never to what a person decided", () => {
  // Guards the route's predicate, which is where this invariant actually lives:
  // a decided request is somebody's act and an extension must not revive it.
  const src = readFileSync("app/api/cycles/[id]/stages/route.ts", "utf8");
  const claim = src.slice(src.indexOf("kpiChangeRequest.findMany"));
  assert.ok(
    /status:\s*"NOT_ACKNOWLEDGED"/.test(claim),
    "the reopen must select ONLY NOT_ACKNOWLEDGED — APPROVED, REJECTED and WITHDRAWN are decisions",
  );
  assert.ok(
    /acknowledgedAt:\s*null/.test(claim),
    "the reopen must also require an unacknowledged row",
  );
});
