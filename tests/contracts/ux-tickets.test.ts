import { before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addWorkingHours, DEFAULT_CALENDAR } from "../../lib/working-time/calendar";
import { ageing, viewWhere } from "../../lib/hive/ticket-clock";

/**
 * UX P1 phase 8 (docs/blueprints/ux-p1-tickets.md): the ticket's internal
 * clock on working hours, ownership, views, and who may do what.
 */

// Muscat is UTC+4; the default week is Sun–Thu, 08:00–17:00.
const muscat = (iso: string) => new Date(`${iso}+04:00`);

test("working hours count only inside the working window", () => {
  // Tue 10:00 + 4h → Tue 14:00.
  assert.equal(
    addWorkingHours(muscat("2026-10-27T10:00:00"), 4).toISOString(),
    muscat("2026-10-27T14:00:00").toISOString(),
  );
  // Tue 15:00 + 4h → 2h Tue, 2h Wed → Wed 10:00.
  assert.equal(
    addWorkingHours(muscat("2026-10-27T15:00:00"), 4).toISOString(),
    muscat("2026-10-28T10:00:00").toISOString(),
  );
  // Thu 16:00 + 2h → 1h Thu, Fri/Sat off, 1h Sun → Sun 09:00.
  assert.equal(
    addWorkingHours(muscat("2026-10-29T16:00:00"), 2).toISOString(),
    muscat("2026-11-01T09:00:00").toISOString(),
  );
  // Raised on a Friday evening: the clock starts Sunday 08:00.
  assert.equal(
    addWorkingHours(muscat("2026-10-30T20:00:00"), 16).toISOString(),
    muscat("2026-11-02T15:00:00").toISOString(),
  );
});

test("a public holiday does not count", () => {
  const calendar = { ...DEFAULT_CALENDAR, holidays: new Set(["2026-10-28"]) };
  // Tue 15:00 + 4h → 2h Tue, Wed is a holiday, 2h Thu → Thu 10:00.
  assert.equal(
    addWorkingHours(muscat("2026-10-27T15:00:00"), 4, calendar).toISOString(),
    muscat("2026-10-29T10:00:00").toISOString(),
  );
});

test("ageing: on time, due within 4 hours, overdue — and nothing once answered", () => {
  const now = new Date("2026-10-27T08:00:00Z");
  assert.equal(ageing("2026-10-28T08:00:00Z", "OPEN", now), "ok");
  assert.equal(ageing("2026-10-27T11:00:00Z", "IN_PROGRESS", now), "soon");
  assert.equal(ageing("2026-10-27T07:00:00Z", "PENDING_APPROVAL", now), "overdue");
  assert.equal(ageing("2026-10-27T07:00:00Z", "SENT", now), "none");
  assert.equal(ageing(null, "OPEN", now), "none");
});

test("views: Mine, Unassigned, Overdue only ever show tickets that still need HR", () => {
  const now = new Date("2026-10-27T08:00:00Z");
  assert.equal(viewWhere("mine", "u1", now).assigneeId, "u1");
  assert.equal(viewWhere("unassigned", "u1", now).assigneeId, null);
  assert.deepEqual(viewWhere("overdue", "u1", now).dueAt, { lt: now });
  for (const v of ["mine", "unassigned", "overdue"] as const) {
    const statuses = (viewWhere(v, "u1", now).status as { in: string[] }).in;
    assert.ok(!statuses.includes("SENT") && !statuses.includes("CLOSED"));
  }
  assert.deepEqual(viewWhere(undefined, "u1", now), {});
});

const mockApi = mock as unknown as {
  module: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const can: Record<string, boolean> = {};
let updated: unknown = null;
let assign: typeof import("../../lib/hive/services/ticket-assign");

before(async () => {
  mockApi.module(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        escalation: {
          findUnique: async ({ where }: { where: { id: string } }) =>
            where.id === "t1" ? { id: "t1", hrPairId: "p1" } : null,
          update: async (args: unknown) => {
            updated = args;
            return { id: "t1" };
          },
        },
        user: { findMany: async () => [] },
      },
    },
  });
  mockApi.module(import.meta.resolve("../../lib/hive/services/permissions.ts"), {
    namedExports: { canOnPair: async (userId: string) => can[userId] ?? false },
  });
  mockApi.module(import.meta.resolve("../../lib/hive/services/ticket-notify.ts"), {
    namedExports: { pairHolders: async () => new Set<string>() },
  });
  assign = await import("../../lib/hive/services/ticket-assign");
});

test("assigning is a drafting act: both people must be able to draft for the pair", async () => {
  can.actor = false;
  assert.deepEqual(await assign.assignEscalation("t1", "actor", "bob"), { error: "forbidden" });
  can.actor = true;
  can.bob = false;
  assert.deepEqual(await assign.assignEscalation("t1", "actor", "bob"), {
    error: "invalid_assignee",
  });
  assert.equal(updated, null, "nothing written on a refusal");
  can.bob = true;
  assert.deepEqual(await assign.assignEscalation("t1", "actor", "bob"), { ok: true });
  assert.deepEqual((updated as unknown as { data: unknown }).data, { assigneeId: "bob" });
  assert.deepEqual(await assign.assignEscalation("t1", "actor", null), { ok: true });
  assert.deepEqual(await assign.assignEscalation("nope", "actor", null), { error: "not_found" });
});

test("routes keep the ticket's own gates", () => {
  const ctx = readFileSync("app/api/hive/escalations/[id]/context/route.ts", "utf8");
  assert.match(ctx, /ticketReach\(ctx\.session\.user\.id\)/);
  assert.match(ctx, /!reach\.includes\(row\.hrPairId\)/);
  assert.match(ctx, /ticketContext\(row, reach\)/);
  assert.match(
    readFileSync("lib/hive/services/ticket-context.ts", "utf8"),
    /reach === "all" \? \{\} : \{ hrPairId: \{ in: reach \} \}/,
  );
  const assignee = readFileSync("app/api/hive/escalations/[id]/assignee/route.ts", "utf8");
  assert.match(assignee, /canOnPair\(ctx\.session\.user\.id, "draftEscalation", row\.hrPairId\)/);
  for (const f of [
    "app/api/hive/saved-replies/route.ts",
    "app/api/hive/saved-replies/[id]/route.ts",
  ]) {
    assert.match(readFileSync(f, "utf8"), /requireHivePermission\("editContent"/);
  }
});

test("the context rail carries no pay, IDs or personal details", () => {
  const src = readFileSync("lib/hive/services/ticket-context.ts", "utf8");
  for (const field of [
    "basicSalary",
    "civilId",
    "passport",
    "personalEmail",
    "dateOfBirth",
    "nationality",
  ]) {
    assert.ok(!src.includes(field), `${field} must not be selected`);
  }
});

test("a new ticket gets its answer-by time; the first sent answer is timed", () => {
  assert.match(readFileSync("lib/hive/services/escalation.ts", "utf8"), /dueAt,\n/);
  assert.match(
    readFileSync("lib/hive/services/escalation-send.ts", "utf8"),
    /firstResponseAt: new Date\(\)/,
  );
});
