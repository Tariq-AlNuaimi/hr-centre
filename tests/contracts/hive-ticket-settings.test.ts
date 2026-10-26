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

let row: Record<string, unknown> | null = null;
let calls: string[] = [];
let createThrows: string | null = null;

before(async () => {
  v = (await import(import.meta.resolve("../../lib/validations/hive/ticket-settings.ts"))) as V;
  if (!canMock) return;
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        hiveTicketSettings: {
          findUnique: async () => row,
          create: async ({ data }: { data: Record<string, unknown> }) => {
            calls.push("create");
            if (createThrows) throw Object.assign(new Error("dup"), { code: createThrows });
            row = { ...data };
            return row;
          },
          update: async ({ data }: { data: Record<string, unknown> }) => {
            calls.push("update");
            row = { ...(row ?? {}), ...data };
            return row;
          },
          upsert: async () => {
            calls.push("upsert");
            return row;
          },
        },
      },
    },
  });
  svc = (await import(import.meta.resolve("../../lib/hive/services/ticket-settings.ts"))) as S;
});

function reset() {
  row = null;
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

describe("the stored row", { skip: !canMock }, () => {
  test("no row means the defaults — a fresh database needs no seed", async () => {
    reset();
    assert.deepEqual(await svc.getTicketSettings(), { ticketPrefix: "HIVE", statusLabels: {} });
  });

  test("a hand-edited row with a junk label set is ignored on read, not rendered", async () => {
    reset();
    row = { ticketPrefix: "HR", statusLabels: { NOPE: "x" } };
    assert.deepEqual(await svc.getTicketSettings(), { ticketPrefix: "HR", statusLabels: {} });
  });

  test("saving goes through the audited create/update, never upsert", async () => {
    reset();
    await svc.updateTicketSettings({ ticketPrefix: "HR", statusLabels: {} }, "u1");
    row = { id: "singleton" };
    await svc.updateTicketSettings({ ticketPrefix: "HIVE", statusLabels: {} }, "u1");
    assert.deepEqual(calls, ["create", "update"]);
  });

  test("two first saves racing: the loser's unique-key error becomes an update", async () => {
    reset();
    createThrows = "P2002";
    await svc.updateTicketSettings({ ticketPrefix: "HR", statusLabels: {} }, "u1");
    assert.deepEqual(calls, ["create", "update"]);
  });
});
