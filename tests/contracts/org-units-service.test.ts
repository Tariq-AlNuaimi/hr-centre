// The org-unit service (lib/org/units.ts; foundation blueprint §1, AC-F1.1/F1.3)
// against a stubbed Prisma: rename-only companies, unique names (retired ones
// included), same-company placement, and retire refused while anything hangs off.
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type Handler = (args: Record<string, unknown>) => unknown;
const calls: Array<{ key: string; args: Record<string, unknown> }> = [];
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
              const key = `${model}.${op}`;
              calls.push({ key, args });
              const h = handlers.get(key);
              if (!h) throw new Error(`unstubbed ${key}`);
              return h(args);
            },
        },
      ),
  },
);

const mockApi = mock as unknown as {
  module: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
let units: typeof import("../../lib/org/units");

before(async () => {
  mockApi.module(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: client,
      prismaUnfiltered: client,
      auditedTransaction: async (fn: (tx: unknown) => unknown) => fn(client),
    },
  });
  units = await import("../../lib/org/units");
});

beforeEach(() => {
  calls.length = 0;
  handlers.clear();
});

const status = (e: unknown) => (e as { status?: number }).status;
const echo = (a: Record<string, unknown>) => ({ id: "x", ...(a.data as object) });
const did = (key: string) => calls.filter((c) => c.key === key).length;

test("renameCompany: 404 for an unknown company; otherwise a name-only update", async () => {
  on("orgEntity.findUnique", () => null);
  await assert.rejects(units.renameCompany("c", "Rihal"), (e) => status(e) === 404);
  on("orgEntity.findUnique", () => ({ id: "c" }));
  on("orgEntity.update", echo);
  await units.renameCompany("c", "Rihal");
  assert.deepEqual(calls.at(-1)!.args.data, { name: "Rihal" });
});

test("createDirectorate: company must exist; a live or retired clash is refused", async () => {
  on("orgEntity.findUnique", () => null);
  await assert.rejects(
    units.createDirectorate({ entityId: "c", name: "Ops" }),
    (e) => status(e) === 400,
  );
  on("orgEntity.findUnique", () => ({ id: "c" }));
  on("directorate.findFirst", () => ({ id: "d" }));
  await assert.rejects(
    units.createDirectorate({ entityId: "c", name: "Ops" }),
    /already has a directorate/,
  );
  on("directorate.findFirst", (a) =>
    (a.where as { deletedAt?: unknown }).deletedAt ? { id: "old" } : null,
  );
  await assert.rejects(
    units.createDirectorate({ entityId: "c", name: "Ops" }),
    /restore it from the recycling bin/,
  );
  on("directorate.findFirst", () => null);
  on("directorate.create", echo);
  await units.createDirectorate({ entityId: "c", name: "Ops" });
  assert.equal(did("directorate.create"), 1);
});

test("renameDirectorate ignores itself in the clash check; retire refused while departments remain", async () => {
  on("directorate.findUnique", () => null);
  await assert.rejects(units.renameDirectorate("d", "X"), (e) => status(e) === 404);
  on("directorate.findUnique", () => ({ id: "d", entityId: "c", _count: { departments: 2 } }));
  on("directorate.findFirst", () => null);
  on("directorate.update", echo);
  await units.renameDirectorate("d", "X");
  const clash = calls.find((c) => c.key === "directorate.findFirst")!;
  assert.deepEqual((clash.args.where as { NOT: unknown }).NOT, { id: "d" });
  await assert.rejects(units.retireDirectorate("d"), /department/);
  on("directorate.findUnique", () => ({ id: "d", _count: { departments: 0 } }));
  on("directorate.delete", () => ({}));
  await units.retireDirectorate("d");
  assert.equal(did("directorate.delete"), 1);
  on("directorate.findUnique", () => null);
  await assert.rejects(units.retireDirectorate("d"), (e) => status(e) === 404);
});

test("createOrgDepartment: a directorate of another company is refused", async () => {
  on("orgEntity.findUnique", () => null);
  await assert.rejects(
    units.createOrgDepartment({ entityId: "c", name: "Eng", directorateId: null }),
    (e) => status(e) === 400,
  );
  on("orgEntity.findUnique", () => ({ id: "c" }));
  on("directorate.findUnique", () => null);
  await assert.rejects(
    units.createOrgDepartment({ entityId: "c", name: "Eng", directorateId: "d" }),
    /that directorate does not exist/,
  );
  on("directorate.findUnique", () => ({ id: "d", entityId: "other" }));
  await assert.rejects(
    units.createOrgDepartment({ entityId: "c", name: "Eng", directorateId: "d" }),
    (e) => status(e) === 400,
  );
  on("directorate.findUnique", () => ({ id: "d", entityId: "c" }));
  on("department.findFirst", () => ({ id: "dup" }));
  await assert.rejects(
    units.createOrgDepartment({ entityId: "c", name: "Eng", directorateId: "d" }),
    /already has a department/,
  );
  on("department.findFirst", (a) =>
    (a.where as { deletedAt?: unknown }).deletedAt ? { id: "old" } : null,
  );
  await assert.rejects(
    units.createOrgDepartment({ entityId: "c", name: "Eng", directorateId: "d" }),
    /retired department/,
  );
  on("department.findFirst", () => null);
  on("department.create", echo);
  await units.createOrgDepartment({ entityId: "c", name: "Eng", directorateId: "d" });
  assert.equal(did("department.create"), 1);
});

const dept = (employees: number) => ({
  id: "p",
  name: "Eng",
  entityId: "c",
  directorateId: "d",
  _count: { employees },
});

test("updateOrgDepartment: no company move while people are in it; a move drops the old directorate", async () => {
  on("department.findUnique", () => null);
  await assert.rejects(units.updateOrgDepartment("p", {}), (e) => status(e) === 404);
  on("department.findUnique", () => dept(1));
  await assert.rejects(units.updateOrgDepartment("p", { entityId: "c2" }), /has 1 person in it/);
  on("department.findUnique", () => dept(0));
  on("orgEntity.findUnique", () => null);
  await assert.rejects(
    units.updateOrgDepartment("p", { entityId: "c2" }),
    (e) => status(e) === 400,
  );
  on("orgEntity.findUnique", () => ({ id: "c2" }));
  on("department.findFirst", () => null);
  on("department.update", echo);
  await units.updateOrgDepartment("p", { entityId: "c2" });
  assert.deepEqual(calls.at(-1)!.args.data, { name: "Eng", entityId: "c2", directorateId: null });
});

test("updateOrgDepartment: a plain rename keeps the directorate and checks the name", async () => {
  on("department.findUnique", () => dept(3));
  on("directorate.findUnique", () => ({ id: "d", entityId: "c" }));
  on("department.findFirst", () => null);
  on("department.update", echo);
  await units.updateOrgDepartment("p", { name: "Engineering" });
  assert.deepEqual(calls.at(-1)!.args.data, {
    name: "Engineering",
    entityId: "c",
    directorateId: "d",
  });
  assert.ok(did("department.findFirst") > 0);
  calls.length = 0;
  await units.updateOrgDepartment("p", {});
  assert.equal(did("department.findFirst"), 0, "nothing renamed, nothing to check");
});

test("retireOrgDepartment: refused with people; otherwise its empty teams retire with it", async () => {
  on("department.findUnique", () => null);
  await assert.rejects(units.retireOrgDepartment("p"), (e) => status(e) === 404);
  on("department.findUnique", () => ({ id: "p", _count: { employees: 2 } }));
  await assert.rejects(units.retireOrgDepartment("p"), /people|person/);
  on("department.findUnique", () => ({ id: "p", _count: { employees: 0 } }));
  on("team.findMany", () => [{ id: "t1" }, { id: "t2" }]);
  on("team.delete", () => ({}));
  on("department.delete", () => ({}));
  await units.retireOrgDepartment("p");
  assert.equal(did("team.delete"), 2);
  assert.equal(did("department.delete"), 1);
  assert.equal(units.plural(1, "person", "people"), "person");
  assert.equal(units.plural(0, "person", "people"), "people");
});
