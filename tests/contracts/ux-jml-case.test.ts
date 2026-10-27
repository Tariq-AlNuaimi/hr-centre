import { before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { daysUntil, formatDay } from "../../lib/format";
import { TABS_FOR, tabFrom } from "../../components/jml/case/tabs";

/**
 * UX P1 phase 6 (docs/blueprints/ux-p1-jml.md): the case screen's tabs, the
 * relative due dates, and the risk-sorted case list.
 */

test("a leaver case has five tabs, not eleven; joiners four; movers three", () => {
  assert.deepEqual(TABS_FOR.LEAVE, ["checklist", "overview", "exit", "documents", "activity"]);
  assert.equal(TABS_FOR.JOIN.length, 4);
  assert.equal(TABS_FOR.MOVE.length, 3);
});

test("old ?tab= links land on the tab that now holds their panel", () => {
  assert.equal(tabFrom("approvals"), "overview");
  assert.equal(tabFrom("compliance"), "overview");
  assert.equal(tabFrom("settlement"), "exit");
  assert.equal(tabFrom("interview"), "exit");
  assert.equal(tabFrom("register"), "documents");
  assert.equal(tabFrom("emails"), "activity");
  assert.equal(tabFrom(null), "checklist");
  assert.equal(tabFrom("nonsense"), "checklist");
});

test("due dates are counted in calendar days, whatever the time of day", () => {
  const today = new Date("2026-10-27T23:30:00Z");
  assert.equal(daysUntil("2026-10-27", today), 0);
  assert.equal(daysUntil("2026-10-24T00:00:00.000Z", today), -3);
  assert.equal(daysUntil("2026-10-31", today), 4);
  // A calendar day is printed as that day, never the day before (UTC formatting).
  assert.match(formatDay("2026-10-25T00:00:00.000Z"), /25/);
  assert.ok(!/\d{1,2}:\d{2}:\d{2}/.test(formatDay("2026-10-25")), "no seconds");
});

const mockApi = mock as unknown as {
  module: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const seen: { findMany?: { orderBy: unknown }; groupBy: unknown[] } = { groupBy: [] };
let read: typeof import("../../lib/jml/engine/case-read");

before(async () => {
  mockApi.module(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      auditedTransaction: async () => {
        throw new Error("not used");
      },
      prismaUnfiltered: {},
      prisma: {
        jmlCase: {
          findMany: async (args: { orderBy: unknown }) => {
            seen.findMany = args;
            return [{ id: "c1" }, { id: "c2" }];
          },
          count: async () => 2,
        },
        jmlTask: {
          groupBy: async (args: { where: { dueDate: { lt?: Date } } }) => {
            seen.groupBy.push(args);
            return args.where.dueDate.lt
              ? [{ caseId: "c1", _count: { _all: 3 } }]
              : [{ caseId: "c2", _min: { dueDate: new Date("2026-11-02") } }];
          },
        },
      },
    },
  });
  read = await import("../../lib/jml/engine/case-read");
});

test("the case list is riskiest first and carries overdue / next-due in two grouped reads", async () => {
  const actor = {
    userId: "u",
    employeeId: null,
    pmsRoles: [],
    isLineManager: false,
    grants: new Map([["jml.view", [{ type: "GROUP", id: null }]]]),
  } as unknown as Parameters<typeof read.listCases>[0];
  const out = await read.listCases(actor, { status: ["ACTIVE"] } as never, {
    page: 1,
    pageSize: 25,
    skip: 0,
    take: 25,
  });
  assert.deepEqual((seen.findMany?.orderBy as unknown[])[0], { ragFlag: "desc" });
  assert.equal(seen.groupBy.length, 2, "one grouped read per signal, never one per case");
  const [c1, c2] = out.rows;
  assert.equal(c1!.overdueTasks, 3);
  assert.equal(c1!.nextDue, null);
  assert.equal(c2!.overdueTasks, 0);
  assert.equal(c2!.nextDue?.toISOString().slice(0, 10), "2026-11-02");
});

test("one primary case action; destructive ones behind More, separated", () => {
  const src = readFileSync("components/jml/case/CaseActions.tsx", "utf8");
  assert.match(src, /function protectiveActions/);
  assert.match(src, /key="cancel"/);
  assert.match(src, /key="withdraw"/);
  assert.match(src, /key="hold"/);
  assert.ok(
    !/protectiveActions[\s\S]*key="odoo"/.test(src.split("function protectiveActions")[1] ?? ""),
  );
});
