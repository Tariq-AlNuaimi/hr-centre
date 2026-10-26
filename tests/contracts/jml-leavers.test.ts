import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_NOTICE_DAYS,
  dateProblems,
  nationalityBranch,
  type DateFacts,
} from "../../lib/jml/leave/rules";
import { leaveActivationProblems } from "../../lib/jml/leave/activation-gate";
import {
  APPROVAL_HOLDERS,
  checkAuthorityConfig,
  checkHolders,
  decisionProblem,
  needsReminder,
} from "../../lib/jml/leave/approval-rules";
import {
  applicableGates,
  checkClosureGates,
  daysLate,
  detectIncidents,
  gateDataProblem,
} from "../../lib/jml/leave/compliance";
import { leaveHealth } from "../../lib/jml/leave/health";
import {
  dispositionProblems,
  dueBeforeToday,
  rekeyEligibility,
} from "../../lib/jml/leave/rekey-rules";
import {
  accessConfirmationProblem,
  rotationFor,
  unsettledAssets,
} from "../../lib/jml/register/rules";
import { generateReversalTasks } from "../../lib/jml/engine/generate";
import { LEAVE_ACCESS_CHECKLIST, LEAVE_TASKS } from "../../prisma/seed-jml-leave-data";
import { cancelExitSchema, createExitSchema, gateSchema } from "../../lib/validations/jml/leave";

/** JML S5 — leavers part 1 (HR Offboarding §6–§12, §17.3; docs/blueprints/jml-s5-leavers.md). */

const d = (s: string) => new Date(`${s}T00:00:00Z`);

const FACTS: DateFacts = {
  exitType: "RESIGNATION",
  exitSubtype: null,
  nationality: "EXPATRIATE",
  noticeStartDate: d("2026-11-01"),
  noticePeriodDays: 60,
  noticePeriodOverrideReason: null,
  lastPhysicalWorkingDay: d("2026-12-20"),
  lastDayOfService: d("2026-12-31"),
  departureDate: d("2027-01-05"),
};

test("§8.3 default notice per exit type", () => {
  assert.deepEqual(DEFAULT_NOTICE_DAYS, {
    RESIGNATION: 60,
    TERMINATION: 30,
    CONTRACT_EXPIRY: 30,
    PROBATION_EXIT: 7,
    SUMMARY_DISMISSAL: 0,
  });
});

test("§6.2 date model: LDS ≥ LPWD ≥ notice start; departure only for expatriates and ≥ LDS", () => {
  assert.deepEqual(dateProblems(FACTS), []);
  const fields = (f: Partial<DateFacts>) => dateProblems({ ...FACTS, ...f }).map((p) => p.field);
  assert.deepEqual(fields({ lastDayOfService: d("2026-12-10") }), ["lastDayOfService"]);
  assert.deepEqual(fields({ lastPhysicalWorkingDay: d("2026-10-01") }), ["lastPhysicalWorkingDay"]);
  assert.deepEqual(fields({ nationality: "OMANI" }), ["departureDate"]);
  assert.deepEqual(fields({ departureDate: d("2026-12-30") }), ["departureDate"]);
  assert.deepEqual(fields({ noticePeriodDays: 45 }), ["noticePeriodOverrideReason"]);
  assert.deepEqual(fields({ noticePeriodDays: 45, noticePeriodOverrideReason: "Agreed" }), []);
  assert.deepEqual(fields({ exitType: "TERMINATION", noticePeriodDays: 30 }), ["exitSubtype"]);
});

test("nationality branch from the free-text record", () => {
  assert.equal(nationalityBranch("Omani"), "OMANI");
  assert.equal(nationalityBranch(" oman "), "OMANI");
  assert.equal(nationalityBranch("Indian"), "EXPATRIATE");
  assert.equal(nationalityBranch(null), null);
});

test("F12: activation re-runs the date rules and collects every blocker", () => {
  const base = {
    ...FACTS,
    status: "DRAFT",
    lineManagerEmployeeId: "m1",
    docRefPerformanceHistory: null,
    docRefWrittenGrounds: null,
    docRefLegalReview: null,
    approvals: [],
  };
  assert.deepEqual(leaveActivationProblems(base), []);
  const bad = leaveActivationProblems({
    ...base,
    lastDayOfService: d("2026-12-01"),
    lineManagerEmployeeId: null,
  });
  assert.deepEqual(bad.map((p) => p.field).sort(), ["lastDayOfService", "lineManager"]);
  const term = leaveActivationProblems({
    ...base,
    exitType: "SUMMARY_DISMISSAL",
    noticePeriodDays: 0,
    departureDate: null,
  });
  assert.deepEqual(
    term.map((p) => p.field),
    [
      "docRefPerformanceHistory",
      "docRefWrittenGrounds",
      "docRefLegalReview",
      "terminationAuthorisation",
    ],
  );
  const granted = leaveActivationProblems({
    ...base,
    exitType: "SUMMARY_DISMISSAL",
    noticePeriodDays: 0,
    departureDate: null,
    docRefPerformanceHistory: "a",
    docRefWrittenGrounds: "b",
    docRefLegalReview: "c",
    approvals: [
      { approvalType: "TERMINATION_AUTHORISATION", holderRoleKey: "HR Manager", status: "GRANTED" },
      {
        approvalType: "TERMINATION_AUTHORISATION",
        holderRoleKey: "Operations Director",
        status: "GRANTED",
      },
    ],
  });
  assert.deepEqual(granted, []);
});

test("F5: five approval types; two-holder types need BOTH signatures", () => {
  assert.equal(Object.keys(APPROVAL_HOLDERS).length, 5);
  assert.deepEqual(APPROVAL_HOLDERS.FINAL_SETTLEMENT_APPROVAL, [
    "HR Manager",
    "Operations Director",
  ]);
  const one = [
    { approvalType: "FINAL_SETTLEMENT_APPROVAL", holderRoleKey: "HR Manager", status: "GRANTED" },
  ];
  assert.deepEqual(checkHolders("FINAL_SETTLEMENT_APPROVAL", one), {
    granted: false,
    missingHolders: ["Operations Director"],
    rejectedHolders: [],
  });
  const refused = [
    ...one,
    {
      approvalType: "FINAL_SETTLEMENT_APPROVAL",
      holderRoleKey: "Operations Director",
      status: "REJECTED",
    },
  ];
  assert.deepEqual(checkHolders("FINAL_SETTLEMENT_APPROVAL", refused).rejectedHolders, [
    "Operations Director",
  ]);
});

test("§4.3 decisions: a grant needs a reference, a refusal a reason, once only", () => {
  const pending = {
    status: "PENDING",
    holderRoleKey: "HR Manager",
    approvalType: "BACKFILL_DECISION",
  };
  const base = { decisionDate: d("2026-11-02"), reference: null, comments: null };
  assert.match(decisionProblem(pending, { ...base, status: "GRANTED" })!, /reference/);
  assert.equal(
    decisionProblem(pending, { ...base, status: "GRANTED", reference: "memo 12" }),
    null,
  );
  assert.match(decisionProblem(pending, { ...base, status: "REJECTED" })!, /reason/);
  assert.match(
    decisionProblem(
      { ...pending, status: "GRANTED" },
      { ...base, status: "REJECTED", comments: "x" },
    )!,
    /already/,
  );
});

test("BR-OFF-021/032: delegate mandatory; second level for two types, never an HR Manager, never the delegate", () => {
  const ctx = { secondLevelIneligible: ["hrm"] };
  assert.equal(
    checkAuthorityConfig(
      { approvalType: "BACKFILL_DECISION", delegateId: "x", secondLevelDelegateId: null },
      ctx,
    ).length,
    0,
  );
  assert.deepEqual(
    checkAuthorityConfig(
      { approvalType: "BACKFILL_DECISION", delegateId: null, secondLevelDelegateId: null },
      ctx,
    ).map((p) => p.field),
    ["delegateId"],
  );
  const fields = (second: string | null) =>
    checkAuthorityConfig(
      { approvalType: "TERMINATION_AUTHORISATION", delegateId: "x", secondLevelDelegateId: second },
      ctx,
    ).map((p) => p.field);
  assert.deepEqual(fields(null), ["secondLevelDelegateId"]);
  assert.deepEqual(fields("hrm"), ["secondLevelDelegateId"]);
  assert.deepEqual(fields("x"), ["secondLevelDelegateId"]);
  assert.deepEqual(fields("y"), []);
});

test("AC-11.3: reminder after more than two working days pending", () => {
  const days = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 86_400_000);
  assert.equal(
    needsReminder({ status: "PENDING", requestedAt: d("2026-11-01") }, d("2026-11-03"), days),
    false,
  );
  assert.equal(
    needsReminder({ status: "PENDING", requestedAt: d("2026-11-01") }, d("2026-11-04"), days),
    true,
  );
  assert.equal(
    needsReminder({ status: "GRANTED", requestedAt: d("2026-11-01") }, d("2026-11-09"), days),
    false,
  );
});

test("§17.3 gates: applicability, absent record = unsatisfied, override counts, C8 needs a classification", () => {
  const omaniResignation = {
    nationality: "OMANI",
    exitType: "RESIGNATION",
    settlementApplicable: false,
  };
  assert.deepEqual(applicableGates(omaniResignation), ["C1", "C6", "C8", "C9", "C11"]);
  assert.deepEqual(
    applicableGates({
      nationality: "EXPATRIATE",
      exitType: "TERMINATION",
      settlementApplicable: true,
    }).length,
    11,
  );
  const records = ["C1", "C6", "C8", "C9"].map((gateId) => ({
    gateId,
    satisfied: true,
    overriddenById: null,
  }));
  assert.deepEqual(
    checkClosureGates(omaniResignation, records).outstanding.map((g) => g.gateId),
    ["C11"],
  );
  const overridden = [...records, { gateId: "C11", satisfied: false, overriddenById: "hrm" }];
  assert.equal(checkClosureGates(omaniResignation, overridden).allowed, true);
  assert.ok(gateDataProblem("C8", null));
  assert.equal(gateDataProblem("C8", "Omanised role"), null);
  assert.equal(gateDataProblem("C1", null), null);
});

test("F15: one days-late function; F16 detection independent of status", () => {
  assert.equal(daysLate(d("2026-11-10"), new Date("2026-11-10T20:00:00Z")), 0);
  assert.equal(daysLate(d("2026-11-10"), d("2026-11-13")), 3);
  const found = detectIncidents(
    {
      lastDayOfService: d("2026-11-01"),
      paymentConfirmedAt: null,
      settlementApplicable: true,
      paymentWindowDays: 7,
      nationality: "EXPATRIATE",
      departureDate: d("2026-11-05"),
      visaCancellationConfirmedAt: d("2026-11-04"),
    },
    d("2026-11-10"),
  );
  assert.deepEqual(
    found.map((i) => [i.kind, i.daysLate]),
    [["SETTLEMENT_PAYMENT_WINDOW", 2]],
  );
});

test("F4: health — RED > 3 working days late or breached ⇒ AT_RISK; Stage 4 with settlement ⇒ PENDING_SETTLEMENT", () => {
  const base = {
    status: "ACTIVE" as const,
    stage: "STAGE_2_IMMEDIATE" as const,
    settlementApplicable: true,
    overdueWorkingDays: [],
    statutoryDaysLeft: null,
  };
  assert.deepEqual(leaveHealth(base), { ragFlag: "GREEN", status: "ACTIVE" });
  assert.deepEqual(leaveHealth({ ...base, overdueWorkingDays: [1] }), {
    ragFlag: "AMBER",
    status: "ACTIVE",
  });
  assert.deepEqual(leaveHealth({ ...base, statutoryDaysLeft: 3 }), {
    ragFlag: "AMBER",
    status: "ACTIVE",
  });
  assert.deepEqual(leaveHealth({ ...base, overdueWorkingDays: [4] }), {
    ragFlag: "RED",
    status: "AT_RISK",
  });
  assert.deepEqual(leaveHealth({ ...base, status: "AT_RISK", statutoryDaysLeft: -1 }), {
    ragFlag: "RED",
    status: "AT_RISK",
  });
  assert.deepEqual(leaveHealth({ ...base, status: "AT_RISK", stage: "STAGE_4_SETTLEMENT" }), {
    ragFlag: "GREEN",
    status: "PENDING_SETTLEMENT",
  });
  assert.deepEqual(
    leaveHealth({ ...base, status: "CLOSED", overdueWorkingDays: [9] }).status,
    "CLOSED",
  );
});

test("§26.1 re-key: eligibility and every past task answered", () => {
  const now = d("2026-11-20");
  const c = {
    noticeStartDate: d("2026-10-01"),
    lastPhysicalWorkingDay: d("2026-11-30"),
    lastDayOfService: d("2026-11-30"),
    migrated: false,
  };
  assert.deepEqual(rekeyEligibility(c, now), []);
  assert.equal(rekeyEligibility({ ...c, noticeStartDate: d("2026-11-25") }, now).length, 1);
  assert.equal(rekeyEligibility({ ...c, noticeStartDate: d("2025-10-01") }, now).length, 1);
  assert.equal(rekeyEligibility({ ...c, migrated: true }, now).length, 1);
  const due = dueBeforeToday(
    [
      { code: "S1-01", dueDate: d("2026-10-02") },
      { code: "S1-02", dueDate: d("2026-11-20") },
      { code: "S2-01", dueDate: d("2026-10-10") },
    ],
    now,
  );
  assert.deepEqual(due, ["S1-01", "S2-01"]);
  const bounds = { noticeStartDate: c.noticeStartDate, now };
  assert.deepEqual(
    dispositionProblems(
      due,
      [
        { code: "S1-01", outcome: "COMPLETED", completedAt: d("2026-10-03") },
        { code: "S2-01", outcome: "STILL_OUTSTANDING" },
      ],
      bounds,
    ),
    [],
  );
  const bad = dispositionProblems(
    due,
    [
      { code: "S1-01", outcome: "COMPLETED", completedAt: d("2026-12-01") },
      { code: "X", outcome: "STILL_OUTSTANDING" },
    ],
    bounds,
  );
  assert.equal(bad.length, 3);
});

test("§9.8 register: rotation cannot be closed by disablement; confirmation trio; T17 settled assets", () => {
  const item = { confirmedDate: null, rotationRequired: true, direction: "REVOKE" as const };
  const full = {
    confirmingParty: "IT",
    confirmedDate: d("2026-11-01"),
    reference: "INC-1",
    coveredByDisablementOf: null,
  };
  assert.equal(accessConfirmationProblem(item, full), null);
  assert.match(
    accessConfirmationProblem(item, { ...full, coveredByDisablementOf: "AD" })!,
    /rotated/,
  );
  assert.match(
    accessConfirmationProblem(
      { ...item, rotationRequired: false },
      { ...full, confirmingParty: null, reference: null },
    )!,
    /confirming party, reference/,
  );
  assert.match(
    accessConfirmationProblem({ ...item, confirmedDate: d("2026-11-01") }, full)!,
    /already/,
  );
  assert.equal(rotationFor(true, false), true);
  assert.equal(
    unsettledAssets([
      { returnedDate: null, writtenOff: false, deductionApplicable: false },
      { returnedDate: d("2026-11-01"), writtenOff: false, deductionApplicable: false },
      { returnedDate: null, writtenOff: true, deductionApplicable: false },
      { returnedDate: null, writtenOff: false, deductionApplicable: true },
    ]),
    1,
  );
});

test("AC-2.3 / F13: reversal tasks only for completed revocations", () => {
  const rev = generateReversalTasks(
    [
      { code: "S3-03", name: "Revoke access", status: "COMPLETED", reversalFlag: true },
      { code: "S3-04", name: "Revoke email", status: "IN_PROGRESS", reversalFlag: true },
      { code: "S1-01", name: "Receive letter", status: "COMPLETED", reversalFlag: false },
    ],
    "LEAVE",
  );
  assert.deepEqual(
    rev.map((r) => [r.code, r.reversalOfCode]),
    [["REV-S3-03", "S3-03"]],
  );
});

test("F24 seed: 50 FULL tasks, 47 LIGHT, 26 access items with the six rotation rows", () => {
  assert.equal(LEAVE_TASKS.length, 50);
  assert.equal(LEAVE_TASKS.filter((t) => !t.fullOnly).length, 47);
  assert.equal(LEAVE_ACCESS_CHECKLIST.length, 26);
  assert.equal(LEAVE_ACCESS_CHECKLIST.filter((i) => i.rotationRequired).length, 6);
  const departure = LEAVE_TASKS.filter((t) => t.dateBasis === "DEPARTURE_DATE");
  assert.deepEqual(
    departure.map((t) => [t.code, t.offsetDays]),
    [["S3-16", -2]],
  );
});

test("boundaries: withdraw needs a reason; a gate is C1–C11; employee is picked", () => {
  assert.equal(cancelExitSchema.safeParse({ reason: "", expectedVersion: 0 }).success, false);
  assert.equal(gateSchema.safeParse({ gateId: "C12", satisfied: true }).success, false);
  assert.equal(gateSchema.safeParse({ gateId: "C10", satisfied: true }).success, true);
  assert.equal(gateSchema.safeParse({ gateId: "C3" }).success, false);
  assert.equal(
    createExitSchema.safeParse({
      exitType: "RESIGNATION",
      noticeStartDate: "2026-11-01",
      noticePeriodDays: 60,
    }).success,
    false,
  );
});
