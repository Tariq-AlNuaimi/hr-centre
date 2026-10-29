import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";

// Spec V2 §8.8 Settings (blueprint T5): the ticket ID prefix and status labels.
// What is worth pinning: a prefix that cannot break `<prefix>-<number>` parsing,
// labels that can never render a status empty, defaults with no row at all, and
// a write that goes through the AUDITED client (not upsert).

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

type V = typeof import("../../lib/validations/hive/ticket-settings.ts");
type S = typeof import("../../lib/hive/services/ticket-settings.ts");
let v: V;
let svc: S;

// The settings live on the core store (module "tickets", ADR-092): one row per key.
let rows = new Map<string, { id: string; value: unknown }>();
let calls: string[] = [];
let createThrows: string | null = null;

type Where = { id?: string; module_key?: { module: string; key: string } };
const keyOf = (w: Where) =>
  w.module_key
    ? `${w.module_key.module}:${w.module_key.key}`
    : [...rows.entries()].find(([, r]) => r.id === w.id)?.[0];

before(async () => {
  v = (await import(import.meta.resolve("../../lib/validations/hive/ticket-settings.ts"))) as V;
  if (!canMock) return;
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        moduleSetting: {
          findUnique: async ({ where }: { where: Where }) => rows.get(keyOf(where) ?? "") ?? null,
          findMany: async ({ where }: { where: { module: string; key: { in: string[] } } }) =>
            where.key.in
              .map((k) => ({ key: k, row: rows.get(`${where.module}:${k}`) }))
              .filter((x) => x.row)
              .map((x) => ({ key: x.key, value: x.row!.value })),
          create: async ({ data }: { data: { module: string; key: string; value: unknown } }) => {
            calls.push("create");
            if (createThrows) {
              const code = createThrows;
              createThrows = null;
              rows.set(`${data.module}:${data.key}`, { id: "raced", value: null });
              throw Object.assign(new Error("dup"), { code });
            }
            rows.set(`${data.module}:${data.key}`, { id: `r${rows.size}`, value: data.value });
            return {};
          },
          update: async ({ where, data }: { where: Where; data: { value: unknown } }) => {
            calls.push("update");
            const k = keyOf(where)!;
            rows.set(k, { id: rows.get(k)?.id ?? "x", value: data.value });
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
  svc = (await import(import.meta.resolve("../../lib/hive/services/ticket-settings.ts"))) as S;
});

function reset() {
  rows = new Map();
  calls = [];
  createThrows = null;
}

describe("the prefix", () => {
  test("is stored uppercase", () => {
    assert.equal(v.ticketPrefixSchema.parse(" hr "), "HR");
  });

  test("cannot contain what would break <prefix>-<number> parsing", () => {
    for (const bad of ["H", "HR-1", "H R", "1HR", "ABCDEFGHIJK", "HÏVE", ""]) {
      assert.equal(v.ticketPrefixSchema.safeParse(bad).success, false, bad);
    }
    for (const good of ["HR", "HIVE", "RHL2", "ABCDEFGHIJ"]) {
      assert.equal(v.ticketPrefixSchema.safeParse(good).success, true, good);
    }
  });
});

describe("the labels", () => {
  test("a blank label is dropped, so the status falls back to its built-in name", () => {
    assert.deepEqual(v.statusLabelsSchema.parse({ OPEN: "  ", SENT: "Answered" }), {
      SENT: "Answered",
    });
  });

  test("only existing statuses can be renamed (B-6: no new statuses)", () => {
    assert.equal(v.statusLabelsSchema.safeParse({ ESCALATED: "x" }).success, false);
    assert.equal(v.statusLabelsSchema.safeParse({ OPEN: "x".repeat(31) }).success, false);
  });
});

describe("the stored settings", { skip: !canMock }, () => {
  test("no row means the defaults — a fresh database needs no seed", async () => {
    reset();
    assert.deepEqual(await svc.getTicketSettings(), {
      ticketPrefix: "HR",
      statusLabels: {},
      responseHours: 16,
    });
  });

  test("a hand-edited junk label set is ignored on read, not rendered", async () => {
    reset();
    rows.set("tickets:ticketPrefix", { id: "a", value: "HR" });
    rows.set("tickets:statusLabels", { id: "b", value: { NOPE: "x" } });
    assert.deepEqual(await svc.getTicketSettings(), {
      ticketPrefix: "HR",
      statusLabels: {},
      responseHours: 16,
    });
  });

  test("a saved value is read back", async () => {
    reset();
    await svc.updateTicketSettings(
      { ticketPrefix: "HIVE", statusLabels: { SENT: "Answered" }, responseHours: 8 },
      "u1",
    );
    assert.deepEqual(await svc.getTicketSettings(), {
      ticketPrefix: "HIVE",
      statusLabels: { SENT: "Answered" },
      responseHours: 8,
    });
  });

  test("an absent answer-by target leaves the stored one unchanged", async () => {
    reset();
    await svc.updateTicketSettings(
      { ticketPrefix: "HR", statusLabels: {}, responseHours: 8 },
      "u1",
    );
    await svc.updateTicketSettings({ ticketPrefix: "HR", statusLabels: {} }, "u1");
    assert.equal((await svc.getTicketSettings()).responseHours, 8);
  });

  test("saving goes through the audited create/update, never upsert", async () => {
    reset();
    await svc.updateTicketSettings({ ticketPrefix: "HR", statusLabels: {} }, "u1");
    await svc.updateTicketSettings({ ticketPrefix: "HIVE", statusLabels: {} }, "u1");
    assert.deepEqual(calls, ["create", "create", "update", "update"]);
  });

  test("two first saves racing: the loser's unique-key error becomes an update", async () => {
    reset();
    createThrows = "P2002";
    await svc.updateTicketSettings({ ticketPrefix: "HR", statusLabels: {} }, "u1");
    assert.deepEqual(calls.slice(0, 2), ["create", "update"]);
    assert.equal((await svc.getTicketSettings()).ticketPrefix, "HR");
  });
});
