// JML task routing — the DB-facing services (lib/jml/routing/{desks,worker,assign}.ts)
// against a stubbed Prisma, so the routing decisions they make from what the
// database returns are pinned without a database. The same paths run for real
// in tests/integration/jml-routing.test.ts.
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type Call = { model: string; op: string; args: Record<string, unknown> };
type Handler = (args: Record<string, unknown>) => unknown;

const calls: Call[] = [];
const handlers = new Map<string, Handler>();
const on = (key: string, h: Handler) => handlers.set(key, h);

/** A Prisma-shaped proxy: `prisma.<model>.<op>(args)` → the handler registered for it. */
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

const notices: Array<{ userIds: string[]; body: string; key: string; kind: string }> = [];

const mockApi = mock as unknown as {
  module: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};

type Desks = typeof import("../../lib/jml/routing/desks");
type Worker = typeof import("../../lib/jml/routing/worker");
type Assign = typeof import("../../lib/jml/routing/assign");
let desks: Desks;
let worker: Worker;
let assign: Assign;

before(async () => {
  mockApi.module(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: client,
      prismaUnfiltered: client,
      auditedTransaction: async (fn: (tx: unknown) => unknown) => fn(client),
    },
  });
  mockApi.module(import.meta.resolve("../../lib/core/notify/user-notify.ts"), {
    namedExports: {
      notifyUsers: async (
        ids: Iterable<string>,
        n: { body: string; key: string; kind: string },
      ) => {
        const userIds = [...ids];
        notices.push({ userIds, body: n.body, key: n.key, kind: n.kind });
        return userIds.length;
      },
    },
  });
  desks = await import("../../lib/jml/routing/desks");
  worker = await import("../../lib/jml/routing/worker");
  assign = await import("../../lib/jml/routing/assign");
});

beforeEach(() => {
  calls.length = 0;
  notices.length = 0;
  handlers.clear();
});

const user = (id: string) => ({ id, name: `User ${id}`, email: `${id}@rihal.om` });

// --- desks ------------------------------------------------------------------

test("getDeskSettings groups members by desk and lists candidates (active logins only)", async () => {
  on("jmlDeskMember.findMany", () => [
    { desk: "IT", user: user("a") },
    { desk: "FINANCE", user: user("b") },
    { desk: "IT", user: user("c") },
  ]);
  on("user.findMany", () => [user("a"), user("b"), user("c"), user("d")]);
  const s = await desks.getDeskSettings();
  assert.deepEqual(
    s.desks.IT.map((u) => u.id),
    ["a", "c"],
  );
  assert.deepEqual(
    s.desks.FINANCE.map((u) => u.id),
    ["b"],
  );
  assert.equal(s.candidates.length, 4);
  const memberQuery = calls.find((c) => c.model === "jmlDeskMember")!;
  assert.deepEqual(memberQuery.args.where, { user: { deletedAt: null } });
  assert.ok(typeof memberQuery.args.take === "number", "bounded");
});

test("saveDeskSettings removes the dropped, adds the new, keeps the rest — one row at a time", async () => {
  on("jmlDeskMember.findMany", (a) =>
    a.select && (a.select as Record<string, unknown>).id
      ? [
          { id: "m1", desk: "IT", userId: "keep" },
          { id: "m2", desk: "IT", userId: "drop" },
          { id: "m3", desk: "FINANCE", userId: "fin" },
        ]
      : [],
  );
  on("jmlDeskMember.delete", () => ({}));
  on("jmlDeskMember.create", () => ({ id: "new" }));
  on("user.findMany", (a) => {
    const where = a.where as { id?: { in: string[] } };
    return where.id ? where.id.in.map((id) => ({ id })) : [];
  });
  await desks.saveDeskSettings({ IT: ["keep", "add"], FINANCE: ["fin"] });
  const deletes = calls.filter((c) => c.op === "delete").map((c) => c.args.where);
  const creates = calls.filter((c) => c.op === "create").map((c) => c.args.data);
  assert.deepEqual(deletes, [{ id: "m2" }]);
  assert.deepEqual(creates, [{ desk: "IT", userId: "add" }]);
  assert.equal(calls.filter((c) => c.op === "createMany" || c.op === "upsert").length, 0);
});

test("saveDeskSettings refuses a person whose login is gone (422), writing nothing", async () => {
  on("user.findMany", () => [{ id: "a" }]);
  await assert.rejects(
    desks.saveDeskSettings({ IT: ["a", "gone"], FINANCE: [] }),
    (e: { status?: number }) => e.status === 422,
  );
  assert.equal(calls.filter((c) => c.op === "create" || c.op === "delete").length, 0);
});

test("desksOf, deskMembers and staffedDesks", async () => {
  on("jmlDeskMember.findMany", (a) =>
    (a.where as { userId?: string }).userId
      ? [{ desk: "FINANCE" }]
      : [
          { desk: "IT", userId: "a" },
          { desk: "IT", userId: "b" },
        ],
  );
  assert.deepEqual([...(await desks.desksOf("x"))], ["FINANCE"]);
  const members = await desks.deskMembers();
  assert.deepEqual(members, { IT: ["a", "b"], FINANCE: [] });
  assert.deepEqual([...desks.staffedDesks(members)], ["IT"]);
});

// --- worker -----------------------------------------------------------------

const actor = { userId: "u1", employeeId: "e1" };

test("workerFacts reads the actor's desks; myTaskWhere ORs ownership with routed work", async () => {
  on("jmlDeskMember.findMany", () => [{ desk: "IT" }]);
  const facts = await worker.workerFacts(actor);
  assert.deepEqual([...facts.desks], ["IT"]);
  assert.equal(facts.employeeId, "e1");
  const where = await worker.myTaskWhere(actor);
  assert.deepEqual(where, {
    OR: [
      { ownerUserId: "u1" },
      {
        OR: [
          { assigneeRole: { in: ["IT"] } },
          { assigneeRole: "LINE_MANAGER", case: { employee: { managerId: "e1" } } },
        ],
      },
    ],
  });
  on("jmlDeskMember.findMany", () => []);
  assert.deepEqual(await worker.myTaskWhere({ userId: "u2", employeeId: null }), {
    ownerUserId: "u2",
  });
});

test("mayWorkAsWorker: HR tasks never; an LM task only for the direct manager; missing case false", async () => {
  on("jmlDeskMember.findMany", () => []);
  on("jmlCase.findUnique", () => ({ employee: { managerId: "e1" } }));
  assert.equal(await worker.mayWorkAsWorker(actor, { caseId: "c", assigneeRole: "HR" }), false);
  assert.equal(calls.filter((c) => c.model === "jmlCase").length, 0, "an HR task needs no lookup");
  assert.equal(
    await worker.mayWorkAsWorker(actor, { caseId: "c", assigneeRole: "LINE_MANAGER" }),
    true,
  );
  assert.equal(await worker.mayWorkAsWorker(actor, { caseId: "c", assigneeRole: "IT" }), false);
  on("jmlCase.findUnique", () => null);
  assert.equal(
    await worker.mayWorkAsWorker(actor, { caseId: "c", assigneeRole: "LINE_MANAGER" }),
    false,
  );
});

test("isRoutedParticipant / hasWorkerTasks: no authority → no query; otherwise one bounded read", async () => {
  on("jmlDeskMember.findMany", () => []);
  const nobody = { userId: "u9", employeeId: null };
  assert.equal(await worker.isRoutedParticipant(nobody, "c"), false);
  assert.equal(await worker.hasWorkerTasks(nobody), false);
  assert.equal(calls.filter((c) => c.model === "jmlTask").length, 0);

  on("jmlTask.count", () => 2);
  on("jmlTask.findFirst", () => ({ id: "t" }));
  assert.equal(await worker.isRoutedParticipant(actor, "c"), true);
  assert.equal(await worker.hasWorkerTasks(actor), true);
  const count = calls.find((c) => c.op === "count")!;
  assert.deepEqual((count.args.where as { AND: unknown[] }).AND[0], { caseId: "c" });
  on("jmlTask.findFirst", () => null);
  assert.equal(await worker.hasWorkerTasks(actor), false);
});

// --- assign -----------------------------------------------------------------

test("routingContextFor: the manager's login, the staffed desks and the HR owner", async () => {
  on("employee.findUnique", () => ({
    manager: { userId: "mgr", deletedAt: null, status: "ACTIVE" },
  }));
  on("jmlDeskMember.findMany", () => [{ desk: "FINANCE", userId: "f" }]);
  const ctx = await assign.routingContextFor(client as never, "e", "hr");
  assert.equal(ctx.hrOwnerUserId, "hr");
  assert.equal(ctx.lineManagerUserId, "mgr");
  assert.deepEqual([...ctx.staffedDesks], ["FINANCE"]);
  on("employee.findUnique", () => ({ manager: null }));
  assert.equal(
    (await assign.routingContextFor(client as never, "e", "hr")).lineManagerUserId,
    null,
  );
});

test("caseRoutingWarnings: none without open routed tasks; names each empty route otherwise", async () => {
  on("jmlTask.groupBy", () => []);
  assert.deepEqual(await assign.caseRoutingWarnings("c", "e"), []);
  assert.equal(calls.filter((c) => c.model === "employee").length, 0);
  on("jmlTask.groupBy", () => [
    { assigneeRole: "IT", _count: { _all: 2 } },
    { assigneeRole: "LINE_MANAGER", _count: { _all: 1 } },
  ]);
  on("employee.findUnique", () => ({ manager: null }));
  on("jmlDeskMember.findMany", () => []);
  assert.deepEqual(await assign.caseRoutingWarnings("c", "e"), [
    "IT_DESK_EMPTY",
    "NO_LINE_MANAGER",
  ]);
});

test("notifyRoutedTasks: one notice per person per case; desk tasks reach every member; HR fallback silent", async () => {
  on("jmlCase.findUnique", () => ({
    caseRef: "EXIT-2026-0001",
    hrOwnerUserId: "hr",
    employee: { name: "Aisha" },
    tasks: [
      { assigneeRole: "IT", ownerUserId: null },
      { assigneeRole: "IT", ownerUserId: null },
      { assigneeRole: "FINANCE", ownerUserId: "hr" }, // empty desk → HR holds it
      { assigneeRole: "LINE_MANAGER", ownerUserId: "mgr" },
    ],
  }));
  on("jmlDeskMember.findMany", () => [
    { desk: "IT", userId: "it1" },
    { desk: "IT", userId: "it2" },
  ]);
  const written = await assign.notifyRoutedTasks("case1");
  assert.equal(written, 3);
  const byUser = Object.fromEntries(notices.map((n) => [n.userIds[0], n.body]));
  assert.match(byUser.it1!, /^2 tasks on EXIT-2026-0001 for Aisha are assigned to you\.$/);
  assert.match(byUser.mgr!, /^1 task on EXIT-2026-0001 for Aisha is assigned to you\.$/);
  assert.equal(byUser.hr, undefined);
  assert.ok(
    notices.every((n) => n.kind === "JML_TASK_ASSIGNED" && n.key === "jml-task-assigned:case1"),
  );
});

test("notifyRoutedTasks never throws and is silent for a case with no routed work", async () => {
  on("jmlCase.findUnique", () => null);
  assert.equal(await assign.notifyRoutedTasks("x"), 0);
  on("jmlCase.findUnique", () => {
    throw new Error("db down");
  });
  const warn = mock.method(console, "warn", () => {});
  assert.equal(await assign.notifyRoutedTasks("x"), 0);
  assert.equal(warn.mock.callCount(), 1);
  warn.mock.restore();
});

test("reconcileLineManagerTasks moves only mismatched open LM tasks and tells the new owner", async () => {
  const kase = (manager: unknown) => ({
    caseRef: "ONB-2026-0002",
    hrOwnerUserId: "hr",
    employee: { name: "Rahul", manager },
  });
  on("jmlTask.findMany", () => [
    {
      id: "t1",
      ownerUserId: "old",
      caseId: "c1",
      case: kase({ userId: "new", deletedAt: null, status: "ACTIVE" }),
    },
    {
      id: "t2",
      ownerUserId: "old",
      caseId: "c1",
      case: kase({ userId: "new", deletedAt: null, status: "ACTIVE" }),
    },
    {
      id: "t3",
      ownerUserId: "new",
      caseId: "c1",
      case: kase({ userId: "new", deletedAt: null, status: "ACTIVE" }),
    },
    {
      id: "t4",
      ownerUserId: "old",
      caseId: "c2",
      case: kase({ userId: "x", deletedAt: null, status: "LEAVER" }),
    },
  ]);
  on("jmlTask.update", () => ({}));
  const r = await assign.reconcileLineManagerTasks(["emp"]);
  assert.deepEqual(r, { checked: 4, moved: 1 });
  const updates = calls
    .filter((c) => c.op === "update")
    .map((c) => [
      (c.args.where as { id: string }).id,
      (c.args.data as { ownerUserId: string }).ownerUserId,
    ]);
  assert.deepEqual(updates, [
    ["t1", "new"],
    ["t2", "new"],
    ["t4", "hr"], // the manager left → back to the HR owner, unannounced
  ]);
  assert.equal(notices.length, 1);
  assert.deepEqual(notices[0]!.userIds, ["new"]);
  assert.match(
    notices[0]!.body,
    /^2 tasks on ONB-2026-0002 for Rahul moved to you as their line manager\.$/,
  );
  const find = calls.find((c) => c.op === "findMany")!;
  assert.deepEqual((find.args.where as { case: { employeeId: unknown } }).case.employeeId, {
    in: ["emp"],
  });
});

test("reconcileLineManagerTasks with no list scans every live case (the sweep); never throws", async () => {
  on("jmlTask.findMany", () => []);
  assert.deepEqual(await assign.reconcileLineManagerTasks(), { checked: 0, moved: 0 });
  const where = calls[0]!.args.where as { case: Record<string, unknown> };
  assert.equal("employeeId" in where.case, false);
  on("jmlTask.findMany", () => {
    throw new Error("db down");
  });
  const warn = mock.method(console, "warn", () => {});
  assert.deepEqual(await assign.reconcileLineManagerTasks(), { checked: 0, moved: 0 });
  warn.mock.restore();
});
