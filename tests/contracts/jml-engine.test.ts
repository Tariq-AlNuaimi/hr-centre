import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { computeProgress, deriveJoinStage, isComplete } from "../../lib/jml/engine/progress";
import {
  advancedLeaveStage,
  canAdvanceStage,
  canCloseStage,
  canCompleteTask,
  type GateTask,
} from "../../lib/jml/engine/gates";
import { criteriaScore, taskApplies, type ConditionFacts } from "../../lib/jml/engine/conditions";
import { leaveTaskApplies } from "../../lib/jml/engine/leave-applicability";
import {
  generateReversalTasks,
  generateTasks,
  recalculateDueDates,
  type TemplateTaskDef,
} from "../../lib/jml/engine/generate";
import { DEFAULT_CALENDAR } from "../../lib/working-time/calendar";
import { STARTER_ROLES, SCOPED_PERMISSIONS, isPermission } from "../../lib/rbac/catalogue";
import { TASK_STATUSES } from "../../lib/jml/vocab";
import { templateShapeProblem } from "../../lib/validations/jml/template";

/** JML S2 — the one case engine (docs/blueprints/jml.md D6). */

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

const t = (status: string, mandatory = true) => ({ status, mandatory }) as never;

test("progress: JOIN excludes N/A and cancelled; empty = 100 (Onboarding §10.4)", () => {
  assert.equal(computeProgress([], "JOIN").completionPct, 100);
  assert.equal(
    computeProgress([t("COMPLETED"), t("NOT_APPLICABLE"), t("CANCELLED")], "JOIN").completionPct,
    100,
  );
  assert.equal(computeProgress([t("COMPLETED"), t("NOT_STARTED")], "JOIN").completionPct, 50);
  assert.equal(
    computeProgress([t("COMPLETED"), t("NOT_STARTED", false)], "JOIN").completionPct,
    100,
  );
});

test("progress: LEAVE keeps cancelled in the denominator; empty = 0 (BR-OFF-018)", () => {
  assert.equal(computeProgress([], "LEAVE").completionPct, 0);
  assert.equal(computeProgress([t("COMPLETED"), t("CANCELLED")], "LEAVE").completionPct, 50);
});

test("progress is FLOORED for every type: 199/200 is never 100 (Onboarding rounding fixed)", () => {
  const tasks = [...Array(199).fill(t("COMPLETED")), t("NOT_STARTED")];
  assert.equal(computeProgress(tasks, "JOIN").completionPct, 99);
  assert.equal(computeProgress(tasks, "LEAVE").completionPct, 99);
});

const st = (stage: string, status: string, name = "x", mandatory = true) =>
  ({ stage, status, name, mandatory }) as never;

test("BR-013: complete needs 100% AND the contract-signed task completed", () => {
  const tasks = [
    st("FIRST_DAY", "COMPLETED"),
    st("FIRST_DAY", "NOT_STARTED", "Sign employment contract", false),
  ];
  assert.equal(isComplete(tasks, "JOIN").complete, false);
  assert.equal(deriveJoinStage(tasks, "JOIN"), "FIRST_WEEK");
  const done = [
    st("FIRST_DAY", "COMPLETED"),
    st("FIRST_DAY", "COMPLETED", "Sign employment contract"),
  ];
  assert.equal(deriveJoinStage(done, "JOIN"), "COMPLETED");
});

test("stage follows the work: first stage with outstanding mandatory work", () => {
  assert.equal(
    deriveJoinStage(
      [
        st("PREBOARDING", "COMPLETED"),
        st("FIRST_DAY", "IN_PROGRESS"),
        st("FIRST_WEEK", "NOT_STARTED"),
      ],
      "JOIN",
    ),
    "FIRST_DAY",
  );
});

const gate = (code: string, extra: Partial<GateTask> = {}): GateTask => ({
  code,
  name: code,
  stage: "STAGE_3_NOTICE_HANDOVER",
  status: "NOT_STARTED",
  blocking: false,
  confirmationRequired: false,
  confirmingParty: null,
  confirmationDate: null,
  externalReference: null,
  dependsOnCodes: [],
  ...extra,
});

test("AC-4.2: a confirmation task names each missing part of the trio", () => {
  const r = canCompleteTask(
    gate("S3-04", { confirmationRequired: true, confirmingParty: "IT" }),
    [],
  );
  assert.equal(r.allowed, false);
  assert.match((r as { reason: string }).reason, /confirmation date, external reference/);
});

test("AC-4.4 / BR-OFF-011: S3-15 cannot complete before S4-04; N/A satisfies a dependency", () => {
  const s404 = gate("S4-04", { stage: "STAGE_4_SETTLEMENT" });
  const s315 = gate("S3-15", { dependsOnCodes: ["S4-04"] });
  assert.equal(canCompleteTask(s315, [s404, s315]).allowed, false);
  assert.equal(canCompleteTask(s315, [{ ...s404, status: "NOT_APPLICABLE" }, s315]).allowed, true);
});

test("AC-4.3: a stage closes on BLOCKING tasks only; stages advance one at a time (F4)", () => {
  const tasks = [
    gate("S1-01", { stage: "STAGE_1_RESIGNATION", blocking: true, status: "COMPLETED" }),
    gate("S1-06", { stage: "STAGE_1_RESIGNATION", status: "NOT_STARTED" }),
    gate("S2-01", { stage: "STAGE_2_IMMEDIATE", blocking: true }),
  ];
  assert.equal(canCloseStage("STAGE_1_RESIGNATION", tasks).allowed, true);
  assert.equal(
    canAdvanceStage("STAGE_1_RESIGNATION", "STAGE_3_NOTICE_HANDOVER", tasks).allowed,
    false,
  );
  assert.equal(advancedLeaveStage("STAGE_1_RESIGNATION", tasks), "STAGE_2_IMMEDIATE");
});

const facts = (over: Partial<ConditionFacts> = {}): ConditionFacts => ({
  companyId: "c1",
  employmentType: "PERMANENT",
  contractTypeId: "k1",
  nationality: "Omani",
  workLocation: "Muscat",
  payrollApplicable: "yes",
  ...over,
});

test("BR-006: an Omani gets no visa task; a null fact matches; unreadable = unconditional", () => {
  const visa = { nationality: { notIn: ["omani"] } };
  assert.equal(taskApplies(visa, facts()), false);
  assert.equal(taskApplies(visa, facts({ nationality: "Indian" })), true);
  assert.equal(taskApplies(visa, facts({ nationality: null })), true);
  assert.equal(taskApplies("garbage", facts()), true);
});

test("8.4.12: payroll applicability is a condition fact", () => {
  assert.equal(
    taskApplies({ payrollApplicable: { in: ["yes"] } }, facts({ payrollApplicable: "no" })),
    false,
  );
});

test("8.4.9: template criteria compare case-insensitively; most pinned wins", () => {
  assert.equal(criteriaScore({ nationality: "OMANI" }, facts()), 1);
  assert.equal(criteriaScore({ nationality: "Indian" }, facts()), null);
  assert.equal(criteriaScore({}, facts()), 0);
});

test("Offboarding §8.4: exit type, nationality branch and settlement must all admit", () => {
  const task = {
    appliesToExitTypes: ["RESIGNATION" as const],
    appliesToNationality: "EXPATRIATE" as const,
    appliesToSettlement: true,
  };
  const profile = {
    exitType: "RESIGNATION" as const,
    nationality: "EXPATRIATE" as const,
    settlementApplicable: true,
  };
  assert.equal(leaveTaskApplies(task, profile), true);
  assert.equal(leaveTaskApplies(task, { ...profile, nationality: "OMANI" }), false);
  assert.equal(leaveTaskApplies(task, { ...profile, settlementApplicable: false }), false);
});

const def = (code: string, over: Partial<TemplateTaskDef> = {}): TemplateTaskDef => ({
  code,
  name: code,
  stage: "STAGE_3_NOTICE_HANDOVER",
  sortOrder: 0,
  dateBasis: "LAST_PHYSICAL_WORKING_DAY",
  offsetDays: 0,
  offsetUnit: "WORKING_DAYS",
  mandatory: true,
  blocking: false,
  confirmationRequired: false,
  defaultConfirmingParty: "IT",
  reversalFlag: false,
  dependsOnCodes: [],
  statutory: false,
  complianceCategory: null,
  conditions: {},
  appliesToExitTypes: [],
  appliesToNationality: "ANY",
  appliesToSettlement: null,
  ...over,
});

test("generation: summary dismissal re-anchors Stage 3 to notice start; absent basis dropped; deps pruned; F10", () => {
  const out = generateTasks(
    [def("S3-03"), def("S3-16", { dateBasis: "DEPARTURE_DATE", dependsOnCodes: ["S3-15"] })],
    {
      caseType: "LEAVE",
      leave: { exitType: "SUMMARY_DISMISSAL", nationality: "OMANI", settlementApplicable: true },
      anchors: { NOTICE_START: d("2026-03-05"), LAST_PHYSICAL_WORKING_DAY: d("2026-04-01") },
    },
    DEFAULT_CALENDAR,
  );
  // S3-16 re-anchored to notice start too, so it IS generated; its dependency is pruned.
  assert.deepEqual(
    out.map((x) => x.code),
    ["S3-03", "S3-16"],
  );
  assert.equal(iso(out[0]!.dueDate), "2026-03-05");
  assert.equal(out[0]!.confirmingParty, "IT");
  assert.deepEqual(out[1]!.dependsOnCodes, []);
});

test("generation: JOIN calendar offsets roll off the weekend and statutory tasks carry a deadline", () => {
  const out = generateTasks(
    [
      def("J-02", {
        stage: "PREBOARDING",
        dateBasis: "START_DATE",
        offsetDays: -9,
        offsetUnit: "CALENDAR_DAYS",
        statutory: true,
        complianceCategory: "VISA",
        conditions: { nationality: { notIn: ["Omani"] } },
      }),
    ],
    {
      caseType: "JOIN",
      facts: facts({ nationality: "Indian" }),
      anchors: { START_DATE: d("2026-03-15") },
    },
    DEFAULT_CALENDAR,
  );
  assert.equal(iso(out[0]!.dueDate), "2026-03-08");
  assert.equal(iso(out[0]!.complianceDeadline!), "2026-03-08");
});

test("AC-3.4: only tasks on a changed basis recalculate, and only real moves are reported", () => {
  const tasks = [
    {
      code: "A",
      dateBasis: "LAST_PHYSICAL_WORKING_DAY" as const,
      offsetDays: 0,
      offsetUnit: "WORKING_DAYS" as const,
      dueDate: d("2026-03-05"),
    },
    {
      code: "B",
      dateBasis: "LAST_DAY_OF_SERVICE" as const,
      offsetDays: 0,
      offsetUnit: "WORKING_DAYS" as const,
      dueDate: d("2026-03-10"),
    },
  ];
  const changes = recalculateDueDates(
    tasks,
    { LAST_PHYSICAL_WORKING_DAY: d("2026-03-05"), LAST_DAY_OF_SERVICE: d("2026-03-10") },
    { LAST_PHYSICAL_WORKING_DAY: d("2026-03-06"), LAST_DAY_OF_SERVICE: d("2026-03-10") },
    DEFAULT_CALENDAR,
  );
  assert.deepEqual(
    changes.map((c) => [c.code, iso(c.to)]),
    [["A", "2026-03-08"]],
  );
});

test("AC-2.3: reversals only for COMPLETED reversible tasks", () => {
  const r = generateReversalTasks(
    [
      { code: "S1-10", name: "Letter", status: "COMPLETED", reversalFlag: true },
      { code: "S3-07", name: "Email", status: "NOT_STARTED", reversalFlag: true },
    ],
    "LEAVE",
  );
  assert.deepEqual(
    r.map((x) => x.code),
    ["REV-S1-10"],
  );
});

test("each case type has its approved status list (Onboarding 10, Offboarding 14)", () => {
  assert.equal(TASK_STATUSES.JOIN.length, 10);
  assert.equal(TASK_STATUSES.LEAVE.length, 14);
});

test("template shape: MOVE needs a change type; stages and bases belong to the type", () => {
  assert.match(
    templateShapeProblem({ caseType: "MOVE", changeType: null, tasks: [] })!,
    /change type/,
  );
  assert.match(
    templateShapeProblem({
      caseType: "JOIN",
      changeType: null,
      tasks: [{ code: "X", stage: "STAGE_1_RESIGNATION", dateBasis: "START_DATE" }],
    })!,
    /stage/,
  );
});

test("D12: JML starter roles nest Junior ⊂ Senior ⊂ Manager, every permission is real and scoped where it should be", () => {
  const role = (k: string) => STARTER_ROLES.find((r) => r.key === k)!.permissions;
  const junior = role("JML_JUNIOR_HR");
  const senior = role("JML_SENIOR_HR");
  const manager = role("JML_HR_MANAGER");
  for (const p of junior) assert.ok(senior.includes(p), p);
  for (const p of senior) assert.ok(manager.includes(p), p);
  for (const p of manager) assert.ok(isPermission(p), p);
  assert.ok(SCOPED_PERMISSIONS.has("jml.view"));
  assert.ok(!SCOPED_PERMISSIONS.has("jml.configure"), "configuration is org-wide only");
  assert.ok(!junior.includes("jml.reopenTasks") && senior.includes("jml.reopenTasks"));
  assert.ok(!senior.includes("jml.approveSettlement") && manager.includes("jml.approveSettlement"));
  // HR Super Admin is NOT silently widened by a module.
  assert.ok(!role("HR_SUPER_ADMIN").some((p) => p.startsWith("jml.")));
});

test("routes never call an admin-only route from a JML form (8.4.2 / F7)", () => {
  const src = readFileSync("components/jml/use-jml.ts", "utf8");
  assert.match(src, /\/api\/jml\/lookups/);
  assert.doesNotMatch(src, /\/api\/org\//);
});
