// JML engine services against a stubbed Prisma: checklist templates (versioning,
// latest-per-name listing, JOIN/MOVE/LEAVE template selection) and HR owner
// assignment (most specific rung wins; seat checks). The rules these services
// encode come from HR Onboarding BR-002/BR-004/BR-016 and HR Offboarding
// BR-OFF-002/BR-OFF-006/BR-OFF-026 (docs/blueprints/jml-s2-engine.md).
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type Call = { model: string; op: string; args: Record<string, unknown> };
type Handler = (args: Record<string, unknown>) => unknown;

const calls: Call[] = [];
const handlers = new Map<string, Handler>();
const on = (key: string, h: Handler) => handlers.set(key, h);

const client = new Proxy(
  {},
  {
    get: (_t, model: string) =>
      new Proxy(
        {},
        {
          get:
            (_m, op: string) =>
            async (args: Record<string, unknown> = {}) => {
              calls.push({ model, op, args });
              const h = handlers.get(`${model}.${op}`);
              if (!h) throw new Error(`unstubbed ${model}.${op}`);
              return h(args);
            },
        },
      ),
  },
);

let grants = new Map<string, Array<{ type: string; id: string | null }>>();

const mockApi = mock as unknown as {
  module: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};

type Templates = typeof import("../../lib/jml/engine/templates");
type Assignment = typeof import("../../lib/jml/engine/assignment");
let templates: Templates;
let assignment: Assignment;

before(async () => {
  mockApi.module(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: client,
      prismaUnfiltered: client,
      auditedTransaction: async (fn: (tx: unknown) => unknown) => fn(client),
    },
  });
  mockApi.module(import.meta.resolve("../../lib/rbac/resolve.ts"), {
    namedExports: { loadGrants: async () => grants, scopeMemberIds: async () => new Set() },
  });
  templates = await import("../../lib/jml/engine/templates");
  assignment = await import("../../lib/jml/engine/assignment");
});

beforeEach(() => {
  calls.length = 0;
  handlers.clear();
  grants = new Map();
});

const page = { page: 1, pageSize: 20, skip: 0, take: 20 };

const task = (code: string, over: Record<string, unknown> = {}) => ({
  id: `id-${code}`,
  code,
  name: code,
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
  assigneeRole: "IT",
  appliesToExitTypes: [],
  appliesToNationality: "ANY",
  appliesToSettlement: null,
  ...over,
});

const template = (over: Record<string, unknown> = {}) => ({
  id: "tpl1",
  name: "Onboarding",
  version: 2,
  active: true,
  caseType: "JOIN",
  changeType: null,
  criteria: {},
  employmentScope: "ANY",
  nationalityScope: "ANY",
  tasks: [task("T01"), task("T02", { assigneeRole: "HR" })],
  ...over,
});

// --- templates ---------------------------------------------------------------

test("listTemplates shows the latest version per name unless every version is asked for", async () => {
  const rows = [
    { id: "a3", name: "A", version: 3 },
    { id: "a2", name: "A", version: 2 },
    { id: "b1", name: "B", version: 1 },
  ];
  on("jmlTaskTemplate.findMany", () => rows);
  on("jmlTaskTemplate.count", () => 3);
  const latest = await templates.listTemplates({ caseType: "JOIN", search: "a" }, page);
  assert.deepEqual(
    latest.data.map((r) => (r as { id: string }).id),
    ["a3", "b1"],
  );
  const where = calls[0]!.args.where as Record<string, unknown>;
  assert.equal(where.caseType, "JOIN");
  assert.deepEqual(where.name, { contains: "a", mode: "insensitive" });
  const all = await templates.listTemplates({ allVersions: true, active: false }, page);
  assert.equal(all.data.length, 3);
});

test("getTemplate: 404 when missing", async () => {
  on("jmlTaskTemplate.findUnique", () => null);
  await assert.rejects(templates.getTemplate("x"), (e: { status?: number }) => e.status === 404);
});

test("updateTemplate: `active` alone toggles in place; nothing at all returns the template", async () => {
  on("jmlTaskTemplate.findUnique", () => template());
  on("jmlTaskTemplate.update", (a) => ({ ...template(), ...(a.data as object) }));
  const same = await templates.updateTemplate("tpl1", {});
  assert.equal(same.id, "tpl1");
  assert.equal(calls.filter((c) => c.op === "update").length, 0);
  const off = await templates.updateTemplate("tpl1", { active: false });
  assert.equal(off.active, false);
  assert.equal(calls.filter((c) => c.op === "create").length, 0, "no new version");
});

test("updateTemplate: a definition change cuts version N+1, carrying tasks (and their routing) forward", async () => {
  on("jmlTaskTemplate.findUnique", () => template());
  on("jmlTaskTemplate.update", () => ({ id: "tpl1" }));
  on("jmlTaskTemplate.findFirst", () => ({ version: 4 }));
  on("jmlTaskTemplate.create", (a) => ({ id: "tpl2", ...(a.data as object) }));
  await templates.updateTemplate("tpl1", { name: "Onboarding" });
  const deactivate = calls.find((c) => c.op === "update")!;
  assert.deepEqual(deactivate.args.data, { active: false });
  const created = calls.find((c) => c.op === "create")!.args.data as {
    version: number;
    tasks: { create: Array<{ code: string; assigneeRole: string; id?: string }> };
  };
  assert.equal(created.version, 5, "after the highest existing version");
  assert.deepEqual(
    created.tasks.create.map((t) => [t.code, t.assigneeRole]),
    [
      ["T01", "IT"],
      ["T02", "HR"],
    ],
  );
  assert.ok(
    created.tasks.create.every((t) => t.id === undefined),
    "new rows, not the old ids",
  );
});

test("updateTemplate refuses a shape that breaks the case type (422) and a racing save (409)", async () => {
  on("jmlTaskTemplate.findUnique", () => template());
  await assert.rejects(
    templates.updateTemplate("tpl1", { changeType: "DEPARTMENT_TRANSFER" }),
    (e: { status?: number }) => e.status === 422,
  );
  on("jmlTaskTemplate.update", () => ({ id: "tpl1" }));
  on("jmlTaskTemplate.findFirst", () => null);
  on("jmlTaskTemplate.create", () => {
    throw Object.assign(new Error("unique"), { code: "P2002" });
  });
  await assert.rejects(
    templates.updateTemplate("tpl1", { name: "Renamed" }),
    (e: { status?: number; message: string }) => e.status === 409 && /a moment ago/.test(e.message),
  );
});

test("createTemplate maps a duplicate name+version to a sentence", async () => {
  on("jmlTaskTemplate.create", () => {
    throw Object.assign(new Error("unique"), { code: "P2002" });
  });
  await assert.rejects(
    templates.createTemplate({
      name: "X",
      active: true,
      caseType: "JOIN",
      changeType: null,
      criteria: {},
      employmentScope: "ANY",
      nationalityScope: "ANY",
      tasks: [],
    }),
    /already exists/,
  );
  on("jmlTaskTemplate.create", (a) => ({ id: "n", ...(a.data as object) }));
  const ok = await templates.createTemplate({
    name: "X",
    active: true,
    caseType: "JOIN",
    changeType: null,
    criteria: {},
    employmentScope: "ANY",
    nationalityScope: "ANY",
    tasks: [task("T01") as never],
  });
  assert.equal((ok as unknown as { id: string }).id, "n");
});

test("selectJoinOrMoveTemplate: every pinned criterion must match and the most specific wins", async () => {
  on("jmlTaskTemplate.findMany", () => [
    { id: "generic", name: "G", version: 1, criteria: {} },
    { id: "omani", name: "O", version: 1, criteria: { nationality: "Omani" } },
    { id: "expat", name: "E", version: 1, criteria: { nationality: "Indian" } },
  ]);
  const facts = { nationality: "Omani" } as never;
  const best = await templates.selectJoinOrMoveTemplate("JOIN", facts, null, client as never);
  assert.equal(best?.id, "omani");
  const where = calls[0]!.args.where as Record<string, unknown>;
  assert.equal("changeType" in where, false, "JOIN ignores change type");
  await templates.selectJoinOrMoveTemplate("MOVE", facts, "DEPARTMENT_TRANSFER", client as never);
  assert.equal((calls[1]!.args.where as Record<string, unknown>).changeType, "DEPARTMENT_TRANSFER");
  on("jmlTaskTemplate.findMany", () => [
    { id: "expat", name: "E", version: 1, criteria: { nationality: "Indian" } },
  ]);
  assert.equal(
    await templates.selectJoinOrMoveTemplate("JOIN", facts, null, client as never),
    null,
  );
});

test("selectLeaveTemplate: FULL for permanent, LIGHT otherwise; exact scopes beat ANY; then version", async () => {
  on("jmlTaskTemplate.findMany", () => [
    { id: "any", name: "A", version: 9, employmentScope: "ANY", nationalityScope: "ANY" },
    { id: "full", name: "F", version: 1, employmentScope: "FULL", nationalityScope: "ANY" },
    { id: "full-om", name: "FO", version: 1, employmentScope: "FULL", nationalityScope: "OMANI" },
  ]);
  const chosen = await templates.selectLeaveTemplate("PERMANENT", "OMANI", client as never);
  assert.equal(chosen?.id, "full-om");
  const where = calls[0]!.args.where as { employmentScope: { in: string[] } };
  assert.deepEqual(where.employmentScope.in, ["FULL", "ANY"]);
  await templates.selectLeaveTemplate(null, "EXPATRIATE", client as never);
  assert.deepEqual(
    (calls[1]!.args.where as { employmentScope: { in: string[] } }).employmentScope.in,
    ["LIGHT", "ANY"],
  );
  on("jmlTaskTemplate.findMany", () => []);
  assert.equal(await templates.selectLeaveTemplate("PERMANENT", "OMANI", client as never), null);
});

test("templateTaskDefs reads the routing role with the rest of the definition", async () => {
  on("jmlTemplateTask.findMany", () => [task("T01")]);
  const defs = await templates.templateTaskDefs("tpl1", client as never);
  assert.equal(defs[0]!.assigneeRole, "IT");
  assert.equal((calls[0]!.args.select as Record<string, boolean>).assigneeRole, true);
});

// --- HR owner assignment -----------------------------------------------------

const rule = (id: string, scope: string) => ({
  id,
  scope,
  scopeId: `${scope}-id`,
  priority: 0,
  active: true,
  caseTypes: [],
  createdAt: new Date(),
  juniorHr: { id: "jr", name: "Jr", email: "jr@rihal.om" },
  seniorHr: { id: "sr", name: "Sr", email: "sr@rihal.om" },
});

test("resolveHrAssignment: department beats directorate beats company; one take-1 query per rung", async () => {
  on("jmlHrAssignmentRule.findMany", (a) => {
    const scope = (a.where as { scope: string }).scope;
    return scope === "DEPARTMENT" ? [] : [rule(`r-${scope}`, scope)];
  });
  on("jmlHrAssignmentRule.count", () => 2);
  const r = await assignment.resolveHrAssignment(
    { entityId: "co", directorateId: "dir", departmentId: "dep" },
    "LEAVE",
    client as never,
  );
  assert.equal(r?.matchedScope, "DIRECTORATE");
  assert.equal(r?.candidateCount, 2);
  const finds = calls.filter((c) => c.op === "findMany");
  assert.equal(finds.length, 3);
  assert.ok(finds.every((c) => c.args.take === 1));
  on("jmlHrAssignmentRule.findMany", () => []);
  assert.equal(
    await assignment.resolveHrAssignment(
      { entityId: "co", directorateId: null, departmentId: null },
      "JOIN",
      client as never,
    ),
    null,
  );
});

test("userHolds: a missing login holds nothing; otherwise the grant decides, in scope", async () => {
  const subject = { entityId: "co", directorateId: null, departmentId: null };
  on("user.findUnique", () => null);
  assert.equal(await assignment.userHolds("u", "jml.workTasks", subject), false);
  on("user.findUnique", () => ({ id: "u" }));
  assert.equal(await assignment.userHolds("u", "jml.workTasks", subject), false);
  grants = new Map([["jml.workTasks", [{ type: "COMPANY", id: "co" }]]]);
  assert.equal(await assignment.userHolds("u", "jml.workTasks", subject), true);
  assert.equal(
    await assignment.userHolds("u", "jml.workTasks", { ...subject, entityId: "other" }),
    false,
  );
});

test("createAssignmentRule checks the target and both seats before writing", async () => {
  const input = {
    scope: "DEPARTMENT" as const,
    scopeId: "dep",
    priority: 0,
    active: true,
    caseTypes: [],
    juniorHrUserId: "jr",
    seniorHrUserId: "sr",
  };
  on("department.findUnique", () => null);
  await assert.rejects(
    assignment.createAssignmentRule(input),
    (e: { status?: number }) => e.status === 404,
  );
  on("department.findUnique", () => ({ entityId: "co", directorateId: "dir" }));
  await assert.rejects(
    assignment.createAssignmentRule({ ...input, seniorHrUserId: "jr" }),
    /two different people/,
  );
  on("user.findUnique", () => ({ id: "x" }));
  grants = new Map([["jml.workTasks", [{ type: "GROUP", id: null }]]]);
  await assert.rejects(assignment.createAssignmentRule(input), /Supervise cases/);
  grants = new Map([["jml.supervise", [{ type: "GROUP", id: null }]]]);
  await assert.rejects(assignment.createAssignmentRule(input), /Work checklist tasks/);
  grants = new Map([
    ["jml.workTasks", [{ type: "GROUP", id: null }]],
    ["jml.supervise", [{ type: "GROUP", id: null }]],
  ]);
  on("jmlHrAssignmentRule.create", (a) => ({ id: "new", ...(a.data as object) }));
  const created = await assignment.createAssignmentRule(input);
  assert.equal(created.id, "new");
  on("orgEntity.findUnique", () => ({ id: "co" }));
  on("directorate.findUnique", () => ({ entityId: "co" }));
  await assignment.createAssignmentRule({ ...input, scope: "COMPANY", scopeId: "co" });
  await assignment.createAssignmentRule({ ...input, scope: "DIRECTORATE", scopeId: "dir" });
  assert.equal(calls.filter((c) => c.op === "create").length, 3);
});

test("updateAssignmentRule: 404 when missing; re-checks seats only when the pair or target moves", async () => {
  on("jmlHrAssignmentRule.findUnique", () => null);
  await assert.rejects(
    assignment.updateAssignmentRule("x", {}),
    (e: { status?: number }) => e.status === 404,
  );
  on("jmlHrAssignmentRule.findUnique", () => rule("r1", "COMPANY"));
  on("jmlHrAssignmentRule.update", (a) => ({ id: "r1", ...(a.data as object) }));
  await assignment.updateAssignmentRule("r1", { priority: 5 });
  assert.equal(calls.filter((c) => c.model === "user").length, 0, "priority alone: no seat check");
  on("orgEntity.findUnique", () => ({ id: "COMPANY-id" }));
  on("user.findUnique", () => ({ id: "x" }));
  grants = new Map([
    ["jml.workTasks", [{ type: "GROUP", id: null }]],
    ["jml.supervise", [{ type: "GROUP", id: null }]],
  ]);
  await assignment.updateAssignmentRule("r1", { juniorHrUserId: "jr2" });
  assert.ok(calls.some((c) => c.model === "user"));
});

test("listAssignmentRules: a company filter covers its directorates and departments", async () => {
  on("directorate.findMany", () => [{ id: "d1" }]);
  on("department.findMany", () => [{ id: "p1" }, { id: "p2" }]);
  on("jmlHrAssignmentRule.findMany", () => [rule("r", "COMPANY")]);
  on("jmlHrAssignmentRule.count", () => 1);
  const res = await assignment.listAssignmentRules(
    { entityId: "co", hrUserId: "jr", scope: "COMPANY", active: true },
    page,
  );
  assert.equal(res.total, 1);
  const where = calls.find((c) => c.model === "jmlHrAssignmentRule")!.args.where as {
    AND: Array<Record<string, unknown>>;
  };
  assert.deepEqual(where.AND[1], { scopeId: { in: ["co", "d1", "p1", "p2"] } });
});

test("listJmlHrUsers merges a person's roles and sorts by name", async () => {
  on("roleAssignment.findMany", () => [
    { user: { id: "b", name: "Badr", email: "b@x" }, role: { permissions: ["jml.workTasks"] } },
    { user: { id: "a", name: "Afra", email: "a@x" }, role: { permissions: ["jml.workTasks"] } },
    { user: { id: "b", name: "Badr", email: "b@x" }, role: { permissions: ["jml.supervise"] } },
  ]);
  const users = await assignment.listJmlHrUsers();
  assert.deepEqual(
    users.map((u) => [u.id, u.supervises]),
    [
      ["a", false],
      ["b", true],
    ],
  );
});
