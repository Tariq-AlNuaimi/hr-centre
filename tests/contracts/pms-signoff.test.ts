import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  hrInterventionDue,
  isLadderExempt,
  ladderEventsFor,
  REMINDER_WINDOW_DAYS,
  type ParticipantComplianceState,
} from "../../lib/pms/compliance";
import {
  EMPLOYEE_DID_NOT_SIGN,
  EMPLOYEE_SIGNED_MANAGER_DID_NOT,
  hrApprovalDecision,
  isFullySigned,
  signOffState,
  signerBlockedReason,
  staleParties,
} from "../../lib/pms/signoff";
import { Prisma } from "../../generated/prisma/client";
import { kpiSetHash, type KpiHashRow } from "../../lib/pms/kpi-select";
import type { StageWindow } from "../../lib/pms/cycle";
import type { PmsActor } from "../../lib/pms/permissions";

// December goal-setting, the stage §5.5 warns about: a grace window here runs
// straight at the cycle boundary.
const STAGE: StageWindow = {
  kind: "GOAL_SETTING",
  opensAt: new Date("2026-12-01T00:00:00Z"),
  deadline: new Date("2026-12-31T00:00:00Z"),
  graceDays: 3,
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const at = (offsetMs: number) => new Date(STAGE.deadline.getTime() + offsetMs);

/** A participant whose manager did everything and whose employee signed. */
const state = (over: Partial<ParticipantComplianceState> = {}): ParticipantComplianceState => ({
  subjectEmployeeId: "emp-1",
  managerEmployeeId: "mgr-1",
  roleTrack: "INDIVIDUAL",
  employeeStatus: "ACTIVE",
  kpiCount: 4,
  employeeSigned: true,
  managerSigned: true,
  goalsApproved: false,
  ...over,
});

const actor = (over: Partial<PmsActor> = {}): PmsActor => ({
  userId: "u1",
  employeeId: "emp-1",
  pmsRoles: [],
  isLineManager: false,
  ...over,
});

const kinds = (events: readonly { kind: string }[]) => events.map((e) => e.kind);

// --- §5.5 rung two: three events, one run -----------------------------------

test("§5.5 a manager who never drafted is escalated to skip-level AND HR in the same run", () => {
  const events = ladderEventsFor(
    state({ kpiCount: 0, employeeSigned: false, managerSigned: false }),
    STAGE,
    at(2 * HOUR),
  );

  assert.deepEqual(
    kinds(events),
    ["DEADLINE_MISSED", "ESCALATED_SKIP_LEVEL", "ESCALATED_HR"],
    "§5.5 notifies the skip-level manager AND HR in parallel the moment the deadline passes",
  );
  for (const event of events) {
    assert.equal(event.managerEmployeeId, "mgr-1", "§5.6 logs whose miss it was");
    assert.equal(event.missedByHours, 2, "§5.6 logs by how long");
    assert.match(event.detail, /did not draft/i);
  }
});

test("§5.5 'employee signed, manager did not' escalates identically, with that exact status", () => {
  const events = ladderEventsFor(
    state({ employeeSigned: true, managerSigned: false }),
    STAGE,
    at(HOUR),
  );

  assert.deepEqual(kinds(events), ["DEADLINE_MISSED", "ESCALATED_SKIP_LEVEL", "ESCALATED_HR"]);
  for (const event of events) {
    assert.equal(
      event.detail,
      EMPLOYEE_SIGNED_MANAGER_DID_NOT,
      "the spec quotes this status; HR reads it, so it is not paraphrasable",
    );
    assert.equal(event.detail, "employee signed, manager did not");
  }
});

test("a manager with no manager of record still reaches HR — there is simply no skip-level", () => {
  const events = ladderEventsFor(
    state({ managerEmployeeId: null, kpiCount: 0, employeeSigned: false, managerSigned: false }),
    STAGE,
    at(HOUR),
  );
  assert.deepEqual(kinds(events), ["DEADLINE_MISSED", "ESCALATED_HR"]);
});

// --- §5.4 the employee's own miss is NOT the manager's record ---------------

test("§5.4 an employee who did not sign produces ONE event with a null manager", () => {
  const events = ladderEventsFor(
    state({ employeeSigned: false, managerSigned: true }),
    STAGE,
    at(5 * HOUR),
  );

  assert.deepEqual(
    kinds(events),
    ["DEADLINE_MISSED"],
    "no escalation: nobody was non-compliant but the employee",
  );
  assert.equal(
    events[0].managerEmployeeId,
    null,
    "§5.4 puts this on the employee — attaching the manager would cost them a miss in §11.2 for work they did on time",
  );
  assert.equal(events[0].detail, EMPLOYEE_DID_NOT_SIGN);
  assert.equal(events[0].detail, "Employee did not sign");
  assert.equal(events[0].missedByHours, 5);
});

// --- §5.5 the grace window gates ONLY the third rung ------------------------

test("§5.5 the grace window does not gate the first two rungs", () => {
  const insideGrace = at(HOUR); // grace is 3 days; this is one hour past the deadline
  const events = ladderEventsFor(
    state({ kpiCount: 0, employeeSigned: false, managerSigned: false }),
    STAGE,
    insideGrace,
  );

  assert.deepEqual(
    kinds(events),
    ["DEADLINE_MISSED", "ESCALATED_SKIP_LEVEL", "ESCALATED_HR"],
    "escalation is immediate; waiting out the grace window would delay every escalation by its length",
  );
  assert.equal(
    hrInterventionDue(state({ kpiCount: 0 }), STAGE, insideGrace),
    false,
    "HR's FORMAL intervention is the only rung the grace window gates",
  );
});

test("§5.5 past the grace window the same three rungs stand, and HR intervention is due", () => {
  const pastGrace = at(4 * DAY);
  const unresolved = state({ kpiCount: 0, employeeSigned: false, managerSigned: false });

  assert.deepEqual(
    kinds(ladderEventsFor(unresolved, STAGE, pastGrace)),
    ["DEADLINE_MISSED", "ESCALATED_SKIP_LEVEL", "ESCALATED_HR"],
    "the grace window adds no fourth rung — HR's interventions are HR's own acts, not the sweep's",
  );
  assert.equal(hrInterventionDue(unresolved, STAGE, pastGrace), true);
});

test("§5.1 HR approval is what resolves a file, even past the grace window", () => {
  const approved = state({
    kpiCount: 0,
    employeeSigned: false,
    managerSigned: false,
    goalsApproved: true,
  });
  assert.deepEqual(ladderEventsFor(approved, STAGE, at(10 * DAY)), []);
  assert.equal(hrInterventionDue(approved, STAGE, at(10 * DAY)), false);
});

test("§5.4 a fully signed set awaiting HR approval is nobody's non-compliance, but it does reach HR", () => {
  const awaiting = state();
  assert.deepEqual(ladderEventsFor(awaiting, STAGE, at(HOUR)), [], "both parties did their part");
  assert.equal(
    hrInterventionDue(awaiting, STAGE, at(4 * DAY)),
    true,
    "§5.4 moved it to HR review; past grace the outstanding action is HR's own",
  );
});

// --- Idempotency ------------------------------------------------------------

test("the ladder's decision is idempotent — a second sweep decides exactly what the first did", () => {
  const missed = state({ kpiCount: 0, employeeSigned: false, managerSigned: false });
  const now = at(7 * HOUR);

  const first = ladderEventsFor(missed, STAGE, now);
  const second = ladderEventsFor(missed, STAGE, now);

  assert.deepEqual(
    second,
    first,
    "same state, same instant, same rows — the DB unique constraint does the rest",
  );
  assert.equal(first.length, 3);
});

// --- §5.5 rung one: approaching the deadline --------------------------------

test("§5.5 a reminder fires inside the window and not before it", () => {
  const drafting = state({ kpiCount: 0, employeeSigned: false, managerSigned: false });

  const early = ladderEventsFor(drafting, STAGE, at(-(REMINDER_WINDOW_DAYS + 1) * DAY));
  assert.deepEqual(early, [], "a reminder eight days out is noise, not a nudge");

  const inWindow = ladderEventsFor(drafting, STAGE, at(-2 * DAY));
  assert.deepEqual(kinds(inWindow), ["REMINDER_SENT"]);
  assert.equal(
    inWindow[0].managerEmployeeId,
    "mgr-1",
    "§5.5 addresses the reminder to the manager",
  );
  assert.equal(inWindow[0].missedByHours, null, "nothing has been missed yet");
  assert.match(inWindow[0].detail, /KPIs not drafted/);
});

test("§5.5 no reminder when there is nothing outstanding", () => {
  assert.deepEqual(ladderEventsFor(state(), STAGE, at(-2 * DAY)), []);
});

test("a stage that has not opened yet escalates nothing", () => {
  const before = new Date("2026-11-01T00:00:00Z");
  assert.deepEqual(ladderEventsFor(state({ kpiCount: 0 }), STAGE, before), []);
});

// --- §8.3 / §12.1 exemptions ------------------------------------------------

test("§8.3 C-Level and §12.1 leavers are outside the ladder entirely", () => {
  const cLevel = state({
    roleTrack: "C_LEVEL",
    kpiCount: 0,
    employeeSigned: false,
    managerSigned: false,
  });
  const leaver = state({
    employeeStatus: "LEAVER",
    kpiCount: 0,
    employeeSigned: false,
    managerSigned: false,
  });

  assert.equal(isLadderExempt(cLevel), true);
  assert.equal(isLadderExempt(leaver), true);
  assert.deepEqual(
    ladderEventsFor(cLevel, STAGE, at(DAY)),
    [],
    "§8.3 they have no goal-setting step to miss",
  );
  assert.deepEqual(
    ladderEventsFor(leaver, STAGE, at(DAY)),
    [],
    "§12.1 pending actions close out — no lingering Overdue",
  );
  assert.equal(hrInterventionDue(leaver, STAGE, at(10 * DAY)), false);
});

// --- §5.1 who may sign ------------------------------------------------------

const subject = { id: "emp-1", managerId: "mgr-1" };

test("§5.1 an employee signs their own set and nobody else's", () => {
  assert.equal(signerBlockedReason({ actor: actor(), party: "EMPLOYEE", subject }), null);
  assert.notEqual(
    signerBlockedReason({ actor: actor({ employeeId: "emp-2" }), party: "EMPLOYEE", subject }),
    null,
  );
});

test("§5.1 not even HR may sign AS the employee — a signature is agreement, not administration", () => {
  const hr = actor({ employeeId: "hr-1", pmsRoles: ["HR_SUPER_ADMIN"] });
  assert.notEqual(signerBlockedReason({ actor: hr, party: "EMPLOYEE", subject }), null);
});

test("§4.2 the MANAGER signature is the direct line manager's; a skip-level's is not", () => {
  assert.equal(
    signerBlockedReason({
      actor: actor({ employeeId: "mgr-1", isLineManager: true }),
      party: "MANAGER",
      subject,
    }),
    null,
  );
  assert.notEqual(
    signerBlockedReason({
      actor: actor({ employeeId: "director-1", isLineManager: true }),
      party: "MANAGER",
      subject,
    }),
    null,
    "§4.2 — sign-off is always reserved for the DIRECT line manager",
  );
});

test("an account with no employee record signs nothing", () => {
  assert.notEqual(
    signerBlockedReason({ actor: actor({ employeeId: null }), party: "EMPLOYEE", subject }),
    null,
  );
  assert.notEqual(
    signerBlockedReason({ actor: actor({ employeeId: null }), party: "MANAGER", subject }),
    null,
  );
});

test("§4.2 the refusal STATUS does not leak whether a participant exists", () => {
  // 404 when answering at all would confirm the row is there; 403 once the
  // caller can already see them. Every other write route in the phase draws the
  // line here, and this one did not until the post-push review found it.
  const stranger = actor({ employeeId: "nobody-1" });
  assert.equal(
    signerBlockedReason({ actor: stranger, party: "EMPLOYEE", subject })?.status,
    404,
    "a stranger probing ids learns nothing from the status code",
  );

  const theirManager = actor({ employeeId: "mgr-1", isLineManager: true });
  assert.equal(
    signerBlockedReason({ actor: theirManager, party: "EMPLOYEE", subject })?.status,
    403,
    "their own manager already knows they exist — tell them whose line it is",
  );

  const hr = actor({ employeeId: "hr-1", pmsRoles: ["HR_SUPER_ADMIN"] });
  assert.equal(
    signerBlockedReason({ actor: hr, party: "EMPLOYEE", subject })?.status,
    403,
    "§4.1 HR sees everyone, so 404 would be a lie rather than a defence",
  );

  assert.equal(
    signerBlockedReason({ actor: actor({ employeeId: null }), party: "MANAGER", subject })?.status,
    403,
    "an unlinked account is told about ITS OWN state, which reveals nothing about the row",
  );
});

test("signature state is derived from rows, never from a status column", () => {
  assert.deepEqual(signOffState([]), { employeeSigned: false, managerSigned: false });
  assert.deepEqual(signOffState([{ party: "MANAGER" }]), {
    employeeSigned: false,
    managerSigned: true,
  });
  assert.equal(isFullySigned(signOffState([{ party: "MANAGER" }, { party: "EMPLOYEE" }])), true);
});

// --- §5.1 / §5.3 / §5.4 HR's approval lock ----------------------------------

const fullSet = [{ weightage: 40 }, { weightage: 60 }];

test("§5.1 HR approves a mutually signed set", () => {
  const decision = hrApprovalDecision({
    state: { employeeSigned: true, managerSigned: true },
    stage: STAGE,
    now: at(-DAY),
    kpis: fullSet,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.allowed && decision.basis, "BOTH_SIGNED");
});

test("§5.3 an incomplete set cannot be LOCKED, not even by HR", () => {
  const decision = hrApprovalDecision({
    state: { employeeSigned: true, managerSigned: true },
    stage: STAGE,
    now: at(-DAY),
    kpis: [{ weightage: 40 }, { weightage: 55 }],
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.allowed ? "" : decision.reason, /100%/);
});

test("§5.4 a locked stage with the employee unsigned moves to HR review, and HR may approve it", () => {
  const unsigned = { employeeSigned: false, managerSigned: true };

  const whileOpen = hrApprovalDecision({
    state: unsigned,
    stage: STAGE,
    now: at(-DAY),
    kpis: fullSet,
  });
  assert.equal(whileOpen.allowed, false, "while the stage is open the employee can still sign");

  const afterLock = hrApprovalDecision({
    state: unsigned,
    stage: STAGE,
    now: at(HOUR),
    kpis: fullSet,
  });
  assert.equal(afterLock.allowed, true);
  assert.equal(afterLock.allowed && afterLock.basis, "HR_REVIEW_EMPLOYEE_UNSIGNED");
  assert.match(afterLock.allowed ? afterLock.note : "", /Employee did not sign/);
});

test("§5.5 a missing MANAGER signature is never waived by approval — it escalates instead", () => {
  const decision = hrApprovalDecision({
    state: { employeeSigned: true, managerSigned: false },
    stage: STAGE,
    now: at(DAY),
    kpis: fullSet,
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.allowed ? "" : decision.reason, /line manager has not signed/i);
});

test("§5.1 there is nothing to approve before a manager drafts", () => {
  const decision = hrApprovalDecision({
    state: { employeeSigned: false, managerSigned: false },
    stage: STAGE,
    now: at(DAY),
    kpis: [],
  });
  assert.equal(decision.allowed, false);
});

// --- §5.3 there is no reject button -----------------------------------------

test("§5.3 the sign-off surface exposes no reject and no un-sign", () => {
  const route = readFileSync(join(process.cwd(), "app/api/signoffs/route.ts"), "utf8");
  assert.equal(/export const DELETE/.test(route), false, "§5.3 — the unsigned state IS the signal");
  assert.equal(/export const PATCH|export const PUT/.test(route), false);
  assert.match(route, /export const POST/);
});

// --- what a signature was given TO (US-12) -----------------------------------
//
// US-12 is explicit that "neither signature prevents further edits", so a set
// CAN move after it is signed. Nothing here blocks that. What these pin is that
// the movement becomes VISIBLE, because the alternative is HR applying §5.1's
// lock to content the employee never saw.

const kpi = (over: Partial<KpiHashRow> = {}) =>
  ({
    id: "k1",
    description: "Ship the migration",
    weightage: new Prisma.Decimal("100"),
    descriptorOutstanding: "a",
    descriptorExcellent: "b",
    descriptorTarget: "c",
    descriptorAlmostAchieved: "d",
    descriptorUnsatisfactory: "e",
    orderIndex: 0,
    ...over,
  }) as KpiHashRow;

test("the digest changes when any of §5.2's six texts or the weightage changes", () => {
  const base = kpiSetHash([kpi()]);
  for (const change of [
    { description: "Ship the migration." },
    { weightage: new Prisma.Decimal("99") },
    { descriptorOutstanding: "a!" },
    { descriptorExcellent: "b!" },
    { descriptorTarget: "c!" },
    { descriptorAlmostAchieved: "d!" },
    { descriptorUnsatisfactory: "e!" },
  ]) {
    assert.notEqual(kpiSetHash([kpi(change)]), base, `${Object.keys(change)[0]} must be covered`);
  }
});

test("the digest changes when the READING ORDER changes", () => {
  // §5.2's levels are read top-down; a manager reordering the set after a
  // signature has changed what the employee agreed to read.
  const a = kpi({ id: "k1", orderIndex: 0 });
  const b = kpi({ id: "k2", orderIndex: 1 });
  const reordered = [kpi({ id: "k1", orderIndex: 1 }), kpi({ id: "k2", orderIndex: 0 })];
  assert.notEqual(kpiSetHash([a, b]), kpiSetHash(reordered));
});

test("the digest does NOT change with the order rows came back from Postgres", () => {
  const a = kpi({ id: "k1", orderIndex: 0 });
  const b = kpi({ id: "k2", orderIndex: 1 });
  assert.equal(kpiSetHash([a, b]), kpiSetHash([b, a]), "sorted before hashing, so this is stable");
});

test("equal decimals hash equally, however they were written", () => {
  // `1.50` and `1.5` are the same weightage. A digest that disagreed would
  // accuse a manager of editing when a re-import merely re-formatted.
  assert.equal(
    kpiSetHash([kpi({ weightage: new Prisma.Decimal("1.50") })]),
    kpiSetHash([kpi({ weightage: new Prisma.Decimal("1.5") })]),
  );
});

test("§5.1 a party who signed the current set is not reported as stale", () => {
  const hash = kpiSetHash([kpi()]);
  assert.deepEqual(staleParties([{ party: "EMPLOYEE", kpiSetHash: hash }], hash), []);
});

test("§5.1 a party who signed an earlier version IS reported", () => {
  const signed = kpiSetHash([kpi()]);
  const now = kpiSetHash([kpi({ description: "reworded after they signed" })]);
  assert.deepEqual(
    staleParties(
      [
        { party: "EMPLOYEE", kpiSetHash: signed },
        { party: "MANAGER", kpiSetHash: now },
      ],
      now,
    ),
    ["EMPLOYEE"],
    "only the party whose signature predates the change",
  );
});

test("a signature with no recorded digest is unknown, never reported as stale", () => {
  // Rows that predate the column. Reporting unknown as "changed" would accuse a
  // manager of editing after a signature on no evidence at all.
  assert.deepEqual(staleParties([{ party: "MANAGER", kpiSetHash: null }], kpiSetHash([kpi()])), []);
});
