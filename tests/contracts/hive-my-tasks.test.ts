import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * HR tickets in the rest of HR Centre (docs/blueprints/hive.md US-H10): home's
 * "waiting on you" and the employee record's tab.
 */

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

let pairs: Record<string, "all" | string[]> = {};
const wheres: Record<string, unknown>[] = [];

type Tasks = typeof import("../../lib/hive/services/my-tasks");
let tasks: Tasks;

before(async () => {
  if (!canMock) return;
  mockApi.module!(import.meta.resolve("../../lib/hive/services/permissions.ts"), {
    namedExports: { pairsFor: async (_u: string, action: string) => pairs[action] ?? [] },
  });
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        escalation: {
          count: async ({ where }: { where: Record<string, unknown> }) => {
            wheres.push(where);
            return 0;
          },
          findMany: async ({ where, take }: { where: Record<string, unknown>; take: number }) => {
            assert.ok(take <= 50, "bounded");
            wheres.push(where);
            return [];
          },
        },
      },
    },
  });
  tasks = (await import(import.meta.resolve("../../lib/hive/services/my-tasks.ts"))) as Tasks;
});

test(
  "no draft or approve anywhere → nothing shown, nothing queried",
  { skip: !canMock },
  async () => {
    pairs = {};
    wheres.length = 0;
    const r = await tasks.ticketTasksFor("u1");
    assert.equal(r.canApprove, false);
    assert.equal(r.canDraft, false);
    assert.equal(wheres.length, 0);
  },
);

test(
  "to approve: own-pair scope, never my own draft (self-approval ban)",
  { skip: !canMock },
  async () => {
    pairs = { approve: ["p1"] };
    wheres.length = 0;
    const r = await tasks.ticketTasksFor("u1");
    assert.equal(r.canApprove, true);
    const w = wheres[0] as { hrPairId: { in: string[] }; OR: Record<string, unknown>[] };
    assert.deepEqual(w.hrPairId, { in: ["p1"] });
    const pending = w.OR.filter((c) => c.status === "PENDING_APPROVAL");
    assert.ok(pending.every((c) => c.draftedById === null || JSON.stringify(c).includes('"NOT"')));
    assert.ok(JSON.stringify(w).includes('"draftedById":"u1"'), "excludes my own drafts");
  },
);

test(
  "to answer: group-wide drafters see every pair's open and reopened tickets",
  { skip: !canMock },
  async () => {
    pairs = { draftEscalation: "all" };
    wheres.length = 0;
    await tasks.ticketTasksFor("u1");
    const w = wheres[0] as Record<string, unknown>;
    assert.equal("hrPairId" in w, false, "no pair filter for a group-wide drafter");
    assert.deepEqual(w.status, { in: ["OPEN", "IN_PROGRESS"] });
  },
);

test("the employee record's tab needs tickets.see; without it the URL shows the overview", () => {
  const page = readFileSync("app/[locale]/(dashboard)/people/[id]/page.tsx", "utf8");
  // (JML S7 folded the module tabs into one list of hidden tabs; same invariant.)
  assert.match(
    page,
    /hasHivePermission\(session\.user\.id, "seeTickets"\)\)\) hiddenTabs\.push\("tickets"\)/,
  );
  assert.match(page, /hiddenTabs\.includes\(requested\) \? "overview"/);
});
