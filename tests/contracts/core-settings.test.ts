import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";

// ADR-092: the core settings store, and the JML desk contacts that read it with
// the deployment's environment variable as the fallback.

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

type Store = typeof import("../../lib/core/settings/store.ts");
type Desks = typeof import("../../lib/jml/desks.ts");
let store: Store;
let desks: Desks;

let rows = new Map<string, { id: string; value: unknown }>();
let calls: string[] = [];

type Where = { id?: string; module_key?: { module: string; key: string } };
const keyOf = (w: Where) =>
  w.module_key
    ? `${w.module_key.module}:${w.module_key.key}`
    : [...rows.entries()].find(([, r]) => r.id === w.id)?.[0];

before(async () => {
  if (!canMock) return;
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        moduleSetting: {
          findUnique: async ({ where }: { where: Where }) => rows.get(keyOf(where) ?? "") ?? null,
          findMany: async ({ where }: { where: { module: string; key: { in: string[] } } }) =>
            where.key.in
              .filter((k) => rows.has(`${where.module}:${k}`))
              .map((k) => ({ key: k, value: rows.get(`${where.module}:${k}`)!.value })),
          create: async ({ data }: { data: { module: string; key: string; value: unknown } }) => {
            calls.push("create");
            rows.set(`${data.module}:${data.key}`, { id: `r${rows.size}`, value: data.value });
            return {};
          },
          update: async ({ where, data }: { where: Where; data: { value: unknown } }) => {
            calls.push("update");
            const k = keyOf(where)!;
            rows.set(k, { id: rows.get(k)!.id, value: data.value });
            return {};
          },
          delete: async ({ where }: { where: Where }) => {
            calls.push("delete");
            rows.delete(keyOf(where)!);
            return {};
          },
          upsert: async () => {
            calls.push("upsert");
            return {};
          },
        },
      },
    },
  });
  store = (await import(import.meta.resolve("../../lib/core/settings/store.ts"))) as Store;
  desks = (await import(import.meta.resolve("../../lib/jml/desks.ts"))) as Desks;
});

function reset() {
  rows = new Map();
  calls = [];
  delete process.env.IT_NOTIFY_EMAIL;
  delete process.env.ODOO_EMPLOYEE_URL;
}

describe("the store", { skip: !canMock }, () => {
  test("a key is namespaced by module", async () => {
    reset();
    await store.writeModuleSetting("hiring", "k", 1);
    assert.equal(await store.readModuleSetting("hiring", "k"), 1);
    assert.equal(await store.readModuleSetting("tickets", "k"), null);
  });

  test("writes are the audited create then update, never upsert", async () => {
    reset();
    await store.writeModuleSetting("jml", "k", "a");
    await store.writeModuleSetting("jml", "k", "b");
    assert.deepEqual(calls, ["create", "update"]);
    assert.equal(await store.readModuleSetting("jml", "k"), "b");
  });

  test("many keys come back in one read, absent keys absent", async () => {
    reset();
    await store.writeModuleSetting("hiring", "a", 1);
    const m = await store.readModuleSettings("hiring", ["a", "b"]);
    assert.deepEqual([...m.entries()], [["a", 1]]);
    assert.equal((await store.readModuleSettings("hiring", [])).size, 0);
  });
});

describe("JML desk contacts", { skip: !canMock }, () => {
  test("unset everywhere means off", async () => {
    reset();
    assert.equal(await desks.desks.it(), null);
  });

  test("the deployment's env var applies until HR save a value", async () => {
    reset();
    process.env.IT_NOTIFY_EMAIL = "it-env@example.com";
    assert.equal(await desks.desks.it(), "it-env@example.com");
    assert.equal((await desks.contactSettings()).itEmail.source, "env");
  });

  test("HR's value wins over the env var; clearing it brings the env var back", async () => {
    reset();
    process.env.IT_NOTIFY_EMAIL = "it-env@example.com";
    await desks.saveContactSettings({ itEmail: "it@example.com" }, "u1");
    assert.equal(await desks.desks.it(), "it@example.com");
    await desks.saveContactSettings({ itEmail: null }, "u1");
    assert.equal(await desks.desks.it(), "it-env@example.com");
  });

  test("the case links read the same store", async () => {
    reset();
    await desks.saveContactSettings({ odooUrl: "https://odoo.example/e" }, "u1");
    const links = await desks.externalSystems();
    assert.equal(links.find((l) => l.key === "odoo")?.url, "https://odoo.example/e");
    assert.equal(links.find((l) => l.key === "staffing-form")?.url, null);
  });
});
