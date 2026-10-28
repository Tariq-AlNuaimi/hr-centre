// The EMP code services (lib/people/employee-code.ts; HR Onboarding §14.1,
// BR-003 / BR-021 / BR-022) against a stubbed Prisma: cutover recording,
// allocation under the row lock, and recording an existing employee's code.
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type Handler = (args: Record<string, unknown>) => unknown;
const calls: Array<{ key: string; args: Record<string, unknown> }> = [];
const handlers = new Map<string, Handler>();
const on = (key: string, h: Handler) => handlers.set(key, h);
const call = (key: string, args: Record<string, unknown>) => {
  calls.push({ key, args });
  const h = handlers.get(key);
  if (!h) throw new Error(`unstubbed ${key}`);
  return h(args);
};

const client = new Proxy(
  {},
  {
    get: (_t, model: string) =>
      model === "$queryRaw"
        ? async (strings: TemplateStringsArray) => call("$queryRaw", { sql: strings.join("?") })
        : new Proxy(
            {},
            {
              get:
                (_m, op: string) =>
                async (args: Record<string, unknown> = {}) =>
                  call(`${model}.${op}`, args),
            },
          ),
  },
);

const mockApi = mock as unknown as {
  module: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
let svc: typeof import("../../lib/people/employee-code");

before(async () => {
  mockApi.module(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: client,
      prismaUnfiltered: client,
      auditedTransaction: async (fn: (tx: unknown) => unknown) => fn(client),
    },
  });
  svc = await import("../../lib/people/employee-code");
});

beforeEach(() => {
  calls.length = 0;
  handlers.clear();
});

const input = {
  prefix: "EMP",
  digits: 4,
  lastManualId: "EMP0311",
  nextValue: 312,
  cutoverAt: new Date("2026-10-01T00:00:00Z"),
  approvedBy: "HR Manager",
};

const status = (e: unknown) => (e as { status?: number }).status;

test("configure: a malformed last code or a value wider than the format is refused before any lock", async () => {
  await assert.rejects(
    svc.configureEmployeeCodeSequence({ ...input, lastManualId: "EMP311" }),
    (e) => /look like EMP0001/.test((e as Error).message),
  );
  await assert.rejects(
    svc.configureEmployeeCodeSequence({ ...input, nextValue: 10_000 }),
    (e) => /does not fit in 4 digits/.test((e as Error).message) && status(e) === 400,
  );
  assert.equal(calls.length, 0);
});

test("configure: the next code must sit above every code already on an employee", async () => {
  on("employee.findMany", () => [
    { employeeCode: "EMP0400" },
    { employeeCode: "EMPX" },
    { employeeCode: "EMP12" },
  ]);
  await assert.rejects(svc.configureEmployeeCodeSequence(input), /EMP0400 is already recorded/);
});

test("configure (first time): next must be last manual + 1; then the singleton is created", async () => {
  on("employee.findMany", () => []);
  on("$queryRaw", () => []);
  await assert.rejects(
    svc.configureEmployeeCodeSequence({ ...input, nextValue: 400 }),
    /next unused number after EMP0311, which is EMP0312/,
  );
  on("employeeCodeSequence.create", (a) => ({ id: "s", ...(a.data as object) }));
  const created = await svc.configureEmployeeCodeSequence(input);
  assert.equal((created as { nextValue: number }).nextValue, 312);
  assert.match(calls.find((c) => c.key === "$queryRaw")!.args.sql as string, /FOR UPDATE/);
  on("employeeCodeSequence.create", () => {
    throw Object.assign(new Error("dup"), { code: "P2002" });
  });
  await assert.rejects(svc.configureEmployeeCodeSequence(input), /someone else a moment ago/);
});

test("configure (afterwards): the next code only moves forward", async () => {
  on("employee.findMany", () => []);
  on("$queryRaw", () => [{ id: "s", prefix: "EMP", digits: 4, nextValue: 320 }]);
  await assert.rejects(
    svc.configureEmployeeCodeSequence(input),
    /cannot move backward from EMP0320/,
  );
  on("employeeCodeSequence.update", (a) => ({ id: "s", ...(a.data as object) }));
  const moved = await svc.configureEmployeeCodeSequence({ ...input, nextValue: 330 });
  assert.equal((moved as { nextValue: number }).nextValue, 330);
});

test("allocate: not configured, exhausted, already taken — each refused; otherwise the next code", async () => {
  on("$queryRaw", () => []);
  await assert.rejects(svc.allocateEmployeeCode(client as never), svc.EmployeeCodeError);
  on("$queryRaw", () => [{ id: "s", prefix: "EMP", digits: 2, nextValue: 100 }]);
  await assert.rejects(svc.allocateEmployeeCode(client as never), /exhausted its 2-digit range/);
  on("$queryRaw", () => [{ id: "s", prefix: "EMP", digits: 4, nextValue: 312 }]);
  on("employeeCodeSequence.update", () => ({}));
  on("employee.findUnique", () => ({ id: "someone" }));
  await assert.rejects(svc.allocateEmployeeCode(client as never), /EMP0312 is already in use/);
  on("employee.findUnique", () => null);
  assert.equal(await svc.allocateEmployeeCode(client as never), "EMP0312");
  const bump = calls.filter((c) => c.key === "employeeCodeSequence.update").at(-1)!;
  assert.deepEqual(bump.args, { where: { id: "s" }, data: { nextValue: 313 } });
});

test("record: format, range and uniqueness rules for an existing employee's code", async () => {
  await assert.rejects(svc.recordEmployeeCode("e", "12-AB"), /letters followed by digits/);
  on("employeeCodeSequence.findUnique", () => ({ prefix: "EMP", digits: 4, nextValue: 312 }));
  await assert.rejects(svc.recordEmployeeCode("e", "EMP12"), /must look like EMP0001/);
  await assert.rejects(svc.recordEmployeeCode("e", "emp0400"), /range the system issues/);
  on("employee.findUnique", () => null);
  await assert.rejects(svc.recordEmployeeCode("e", "EMP0042"), (e) => status(e) === 404);
  on("employee.findUnique", (a) =>
    (a.where as { id?: string }).id ? { id: "e", employeeCode: "EMP0001" } : null,
  );
  await assert.rejects(svc.recordEmployeeCode("e", "EMP0042"), /already has EMP0001/);
  on("employee.findUnique", (a) =>
    (a.where as { id?: string }).id ? { id: "e", employeeCode: null } : { id: "other" },
  );
  await assert.rejects(svc.recordEmployeeCode("e", "EMP0042"), /already belongs to another/);
  on("employee.findUnique", (a) =>
    (a.where as { id?: string }).id ? { id: "e", employeeCode: null } : null,
  );
  on("employee.update", () => ({ id: "e" }));
  assert.equal(await svc.recordEmployeeCode("e", " emp0042 "), "EMP0042");
  on("employee.update", () => {
    throw Object.assign(new Error("dup"), { code: "P2002" });
  });
  await assert.rejects(svc.recordEmployeeCode("e", "EMP0042"), /already belongs to another/);
});

test("record before the cutover exists: any well-formed free code is accepted", async () => {
  on("employeeCodeSequence.findUnique", () => null);
  on("employee.findUnique", (a) =>
    (a.where as { id?: string }).id ? { id: "e", employeeCode: null } : null,
  );
  on("employee.update", () => ({ id: "e" }));
  assert.equal(await svc.recordEmployeeCode("e", "OLD9"), "OLD9");
  assert.equal(svc.formatEmployeeCode("EMP", 4, 7), "EMP0007");
  assert.equal(svc.parseEmployeeCode("emp", 4, "emp0007"), null, "prefix must be capitals");
});
