import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  deskOf,
  resolveTaskOwner,
  routingWarnings,
  workerChangeProblem,
  workerMayWork,
  type RoutingContext,
} from "../../lib/jml/routing/rules";
import { managerLogin } from "../../lib/jml/routing/assign";
import { workerTaskWhere } from "../../lib/jml/routing/worker";
import { generateTasks, type TemplateTaskDef } from "../../lib/jml/engine/generate";
import { DEFAULT_CALENDAR } from "../../lib/working-time/calendar";
import { deskSettingsSchema } from "../../lib/validations/jml/routing";
import { createTemplateSchema } from "../../lib/validations/jml/template";
import { SEEDED_ASSIGNEE_ROLES, seededAssigneeRole } from "../../prisma/seed-jml-routing";
import { STARTER_JOIN_TEMPLATE, STARTER_MOVE_TEMPLATES } from "../../prisma/seed-jml-templates";
import { LEAVE_TASKS } from "../../prisma/seed-jml-leave-data";
import { JML_TABS } from "../../lib/nav/tabs";
import type { NavContext } from "../../lib/nav/config";

/** JML task routing (docs/blueprints/jml-task-routing.md). */

const read = (p: string) => readFileSync(p, "utf8");

const ctx = (over: Partial<RoutingContext> = {}): RoutingContext => ({
  hrOwnerUserId: "hr",
  lineManagerUserId: "mgr",
  staffedDesks: new Set(["IT", "FINANCE"]),
  ...over,
});

test("D2–D4: owner per role — HR owner, the manager, the desk as a group", () => {
  assert.equal(resolveTaskOwner("HR", ctx()), "hr");
  assert.equal(resolveTaskOwner("LINE_MANAGER", ctx()), "mgr");
  assert.equal(resolveTaskOwner("IT", ctx()), null, "desk task: owned by the desk");
  assert.equal(resolveTaskOwner("FINANCE", ctx()), null);
});

test("D3: an empty desk or a missing manager falls back to the HR owner", () => {
  const empty = ctx({ staffedDesks: new Set(["FINANCE"]), lineManagerUserId: null });
  assert.equal(resolveTaskOwner("IT", empty), "hr");
  assert.equal(resolveTaskOwner("FINANCE", empty), null);
  assert.equal(resolveTaskOwner("LINE_MANAGER", empty), "hr");
});

test("US-5: warnings name each open route with nobody on it, and nothing else", () => {
  assert.deepEqual(routingWarnings(["HR", "IT", "LINE_MANAGER"], ctx()), []);
  assert.deepEqual(
    routingWarnings(["IT", "FINANCE", "LINE_MANAGER"], {
      staffedDesks: new Set(),
      lineManagerUserId: null,
    }),
    ["IT_DESK_EMPTY", "FINANCE_DESK_EMPTY", "NO_LINE_MANAGER"],
  );
  assert.deepEqual(
    routingWarnings(["HR"], { staffedDesks: new Set(), lineManagerUserId: null }),
    [],
    "no routed task open → no warning",
  );
});

test("D4: derived authority — desk members their desk, the DIRECT manager LM tasks, HR tasks never", () => {
  const desk = { desks: new Set(["IT"] as const), employeeId: "e-desk" };
  const mgr = { desks: new Set<"IT" | "FINANCE">(), employeeId: "m1" };
  const report = { managerId: "m1" };
  const otherTeam = { managerId: "m2" };
  assert.equal(workerMayWork(desk, { assigneeRole: "IT" }, report), true);
  assert.equal(workerMayWork(desk, { assigneeRole: "FINANCE" }, report), false);
  assert.equal(workerMayWork(desk, { assigneeRole: "HR" }, report), false);
  assert.equal(workerMayWork(mgr, { assigneeRole: "LINE_MANAGER" }, report), true);
  assert.equal(workerMayWork(mgr, { assigneeRole: "LINE_MANAGER" }, otherTeam), false);
  assert.equal(workerMayWork(mgr, { assigneeRole: "IT" }, report), false);
  assert.equal(
    workerMayWork(
      { desks: new Set(), employeeId: null },
      { assigneeRole: "LINE_MANAGER" },
      {
        managerId: null,
      },
    ),
    false,
    "no employee record and no manager never match",
  );
  assert.equal(deskOf("LINE_MANAGER"), null);
});

test("AC-4.2/4.3: a worker does the work, never the planning", () => {
  assert.equal(
    workerChangeProblem({ status: "COMPLETED", expectedVersion: 2 }, "NOT_STARTED"),
    null,
  );
  assert.equal(
    workerChangeProblem(
      {
        status: "COMPLETED",
        confirmingParty: "IT",
        confirmationDate: new Date(),
        externalReference: "R1",
      },
      "IN_PROGRESS",
    ),
    null,
  );
  assert.equal(
    workerChangeProblem({ status: "DELAYED", delayReason: "waiting" }, "NOT_STARTED"),
    null,
  );
  assert.match(workerChangeProblem({ ownerUserId: "x" }, "NOT_STARTED")!, /Only HR/);
  assert.match(workerChangeProblem({ dueDate: new Date() }, "NOT_STARTED")!, /Only HR/);
  assert.match(workerChangeProblem({ status: "NOT_APPLICABLE" }, "NOT_STARTED")!, /not applicable/);
  assert.match(workerChangeProblem({ status: "IN_PROGRESS" }, "COMPLETED")!, /re-open/);
  assert.equal(workerChangeProblem({ ownerUserId: undefined }, "NOT_STARTED"), null);
});

test("the worker filter is one OR: desks' tasks and direct reports' LM tasks, or null", () => {
  assert.equal(workerTaskWhere({ desks: new Set(), employeeId: null }), null);
  assert.deepEqual(workerTaskWhere({ desks: new Set(["FINANCE"]), employeeId: null }), {
    OR: [{ assigneeRole: { in: ["FINANCE"] } }],
  });
  assert.deepEqual(workerTaskWhere({ desks: new Set(), employeeId: "m1" }), {
    OR: [{ assigneeRole: "LINE_MANAGER", case: { employee: { managerId: "m1" } } }],
  });
});

test("a manager routes to their login only while on file and not a leaver", () => {
  assert.equal(managerLogin({ userId: "u", deletedAt: null, status: "ACTIVE" }), "u");
  assert.equal(managerLogin({ userId: "u", deletedAt: new Date(), status: "ACTIVE" }), null);
  assert.equal(managerLogin({ userId: "u", deletedAt: null, status: "LEAVER" }), null);
  assert.equal(managerLogin({ userId: null, deletedAt: null, status: "ACTIVE" }), null);
  assert.equal(managerLogin(null), null);
});

test("generation copies the template task's assignee role onto the case task", () => {
  const def: TemplateTaskDef = {
    code: "T22",
    name: "Hand over laptop",
    stage: "FIRST_DAY",
    sortOrder: 0,
    dateBasis: "START_DATE",
    offsetDays: 0,
    offsetUnit: "CALENDAR_DAYS",
    mandatory: true,
    blocking: false,
    confirmationRequired: false,
    defaultConfirmingParty: null,
    reversalFlag: false,
    dependsOnCodes: [],
    statutory: false,
    complianceCategory: null,
    conditions: {},
    appliesToExitTypes: [],
    appliesToNationality: "ANY",
    appliesToSettlement: null,
    assigneeRole: "IT",
  };
  const [task] = generateTasks(
    [def],
    {
      caseType: "JOIN",
      facts: {} as never,
      anchors: { START_DATE: new Date(Date.UTC(2026, 10, 2)) },
    },
    DEFAULT_CALENDAR,
  );
  assert.equal(task?.assigneeRole, "IT");
});

test("US-1: desk settings — de-duplicated, at most 50 per desk, nothing else accepted", () => {
  const ok = deskSettingsSchema.parse({ IT: ["a", "a", "b"], FINANCE: [] });
  assert.deepEqual(ok.IT, ["a", "b"]);
  assert.equal(
    deskSettingsSchema.safeParse({ IT: Array.from({ length: 51 }, (_, i) => `u${i}`), FINANCE: [] })
      .success,
    false,
  );
  assert.equal(deskSettingsSchema.safeParse({ IT: [], FINANCE: [], HR: [] }).success, false);
  assert.equal(deskSettingsSchema.safeParse({ IT: [] }).success, false);
});

test("US-2: a template task defaults to HR and accepts the four roles only", () => {
  const base = {
    name: "X",
    caseType: "JOIN",
    tasks: [
      {
        code: "T1",
        name: "A",
        stage: "FIRST_DAY",
        dateBasis: "START_DATE",
        offsetUnit: "CALENDAR_DAYS",
      },
    ],
  };
  const parsed = createTemplateSchema.parse(base);
  assert.equal(parsed.tasks[0]!.assigneeRole, "HR");
  for (const role of ["LINE_MANAGER", "IT", "FINANCE"]) {
    const r = createTemplateSchema.parse({
      ...base,
      tasks: [{ ...base.tasks[0], assigneeRole: role }],
    });
    assert.equal(r.tasks[0]!.assigneeRole, role);
  }
  assert.equal(
    createTemplateSchema.safeParse({ ...base, tasks: [{ ...base.tasks[0], assigneeRole: "PRO" }] })
      .success,
    false,
  );
});

/** The seeded tasks by template name → code → task name. */
function seededNames(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const tpl of [STARTER_JOIN_TEMPLATE, ...STARTER_MOVE_TEMPLATES]) {
    out[tpl.name] = Object.fromEntries(tpl.tasks.map((t) => [t.code, t.name]));
  }
  const leave = Object.fromEntries(LEAVE_TASKS.map((t) => [t.code, t.name]));
  out["Baseline offboarding — Full"] = leave;
  out["Baseline offboarding — Light"] = leave;
  return out;
}

test("seed mapping: every mapped task exists in its seeded template", () => {
  const names = seededNames();
  for (const [tpl, map] of Object.entries(SEEDED_ASSIGNEE_ROLES)) {
    assert.ok(names[tpl], `unknown template ${tpl}`);
    for (const code of Object.keys(map)) assert.ok(names[tpl]![code], `${tpl} has no ${code}`);
  }
  assert.equal(seededAssigneeRole("Standard onboarding (§10.2 starter)", "T22"), "IT");
  assert.equal(seededAssigneeRole("Baseline offboarding — Full", "S4-06"), "FINANCE");
  assert.equal(
    seededAssigneeRole("Baseline offboarding — Full", "S3-03"),
    "HR",
    "Instruct IT stays HR",
  );
  assert.equal(seededAssigneeRole("Unknown", "T1"), "HR");
});

test("seed mapping and the production back-fill migration are the SAME list", () => {
  const sql = read("prisma/migrations/20261028101456_jml_task_routing/migration.sql");
  const re =
    /SET "assignee_role" = '(\w+)' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = '((?:[^']|'')+)' AND tt."code" = '([^']+)' AND tt."name" = '((?:[^']|'')+)' AND tt."assignee_role" = 'HR';/g;
  const fromSql = new Map<string, string>();
  const names = seededNames();
  for (const m of sql.matchAll(re)) {
    const tpl = m[2]!.replaceAll("''", "'");
    const taskName = m[4]!.replaceAll("''", "'");
    assert.equal(taskName, names[tpl]?.[m[3]!], `${tpl} ${m[3]} matches the seeded name`);
    fromSql.set(`${tpl}|${m[3]}`, m[1]!);
  }
  const fromSeed = new Map<string, string>();
  for (const [tpl, map] of Object.entries(SEEDED_ASSIGNEE_ROLES)) {
    for (const [code, role] of Object.entries(map)) fromSeed.set(`${tpl}|${code}`, role);
  }
  assert.deepEqual([...fromSql].sort(), [...fromSeed].sort());
  assert.doesNotMatch(sql, /DROP |DELETE FROM/i, "additive migration");
});

test("seeds create template tasks with their mapped role", () => {
  assert.match(
    read("prisma/seed-jml-templates.ts"),
    /assigneeRole: seededAssigneeRole\(tpl\.name, task\.code\)/,
  );
  assert.match(
    read("prisma/seed-jml-leave.ts"),
    /assigneeRole: seededAssigneeRole\(tpl\.name, t\.code\)/,
  );
});

test("worst path: a routed participant gets 403 from every case door, anyone else 404", () => {
  const access = read("lib/jml/access.ts");
  assert.match(
    access,
    /if \(await isRoutedParticipant\(actor, row\.id\)\) \{\s*throw new JmlError\([^)]*403\)/,
  );
  assert.match(access, /throw new JmlError\("Case not found", 404\);\s*\}/);
  // The settlement (Restricted figures) is behind that same door.
  assert.match(
    read("lib/jml/leave/settlement.ts"),
    /loadCaseFor\(actor, caseId, "jml\.view", "LEAVE"\)/,
  );
});

test("the task engine falls back to derived authority and narrows it", () => {
  const tasks = read("lib/jml/engine/tasks.ts");
  assert.match(tasks, /mayWorkAsWorker\(actor, task\)/);
  assert.match(tasks, /limited: true/);
  const update = read("lib/jml/engine/task-update.ts");
  assert.match(
    update,
    /if \(limited\) \{[\s\S]*workerChangeProblem\(input, task\.status\)[\s\S]*403/,
  );
});

test("generation resolves owners through the routing rules, for every case type", () => {
  assert.match(
    read("lib/jml/engine/materialise.ts"),
    /ownerUserId: resolveTaskOwner\(t\.assigneeRole, routing\)/,
  );
  for (const f of [
    "lib/jml/join/activation.ts",
    "lib/jml/leave/activation.ts",
    "lib/jml/move/create.ts",
  ]) {
    const src = read(f);
    assert.match(src, /routingContextFor\(tx,/, f);
    assert.match(src, /notifyRoutedTasks\(/, f);
  }
});

test("D6: the manager edit and the hourly sweep reconcile LINE_MANAGER tasks", () => {
  assert.match(read("app/api/employees/[id]/route.ts"), /reconcileLineManagerTasks\(\[id\]\)/);
  assert.match(
    read("lib/jml/sweep.ts"),
    /name: "lineManagerTasks", run: \(\) => reconcileLineManagerTasks\(\)/,
  );
});

test("nav: My tasks shows for HR task workers and for routed workers, nobody else", () => {
  const tab = JML_TABS.find((t) => t.key === "jml-my-tasks")!;
  const base = { jml: () => false, jmlTaskWorker: false } as unknown as NavContext;
  assert.equal(tab.show(base), false);
  assert.equal(tab.show({ ...base, jmlTaskWorker: true }), true);
  assert.equal(
    tab.show({ ...base, jml: (p: string) => p === "jml.workTasks" } as NavContext),
    true,
  );
});

test("notices carry names and refs only, and go through the login writer", () => {
  const src = read("lib/jml/routing/assign.ts");
  assert.match(src, /notifyUsers\(/);
  assert.match(src, /kind: "JML_TASK_ASSIGNED"/);
  assert.doesNotMatch(src, /salary|settlement|figures|civilId|passport/i);
});
