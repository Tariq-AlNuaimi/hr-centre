import { before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isPendingEmployeeId } from "../../lib/people/pending-id";
import { employeeListQuerySchema } from "../../lib/validations/employee";
import { RECORD_TABS } from "../../components/people/RecordTabs";

/**
 * UX P1 phase 3 (docs/blueprints/ux-p1-people.md): the employee record's
 * category tabs, History that never discloses values, and the directory's
 * server-side filters.
 */

const mockApi = mock as unknown as {
  module: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};

let lastArgs: { select?: Record<string, unknown>; take?: number; where?: unknown } | null = null;
const rows = [
  {
    id: "a1",
    action: "UPDATE",
    changes: {
      jobTitle: { from: "A", to: "B" },
      basicSalaryEnc: { from: "x", to: "y" },
      updatedAt: {},
    },
    actorEmail: "hr@example.com",
    timestamp: new Date("2026-10-01T09:00:00Z"),
    user: { name: "Muna" },
  },
  {
    id: "a2",
    action: "CREATE",
    changes: null,
    actorEmail: null,
    timestamp: new Date(),
    user: null,
  },
];

let history: typeof import("../../lib/people/history");

before(async () => {
  mockApi.module(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        auditLog: {
          findMany: async (args: typeof lastArgs) => {
            lastArgs = args;
            return rows;
          },
        },
      },
    },
  });
  history = await import("../../lib/people/history");
});

test("History reads the employee's own audit rows, newest first, bounded", async () => {
  await history.employeeHistory("emp1");
  assert.deepEqual(lastArgs?.where, { entityType: "Employee", entityId: "emp1" });
  assert.equal(lastArgs?.take, 50);
});

test("History never selects a value — only what changed, who and when", async () => {
  await history.employeeHistory("emp1");
  const select = lastArgs?.select ?? {};
  assert.ok(!("before" in select) && !("after" in select), "before/after carry values");
  const out = await history.employeeHistory("emp1");
  assert.deepEqual(out[0]!.fields, ["jobTitle", "basicSalaryEnc"]);
  assert.equal(out[0]!.actor, "Muna");
  assert.ok(!JSON.stringify(out).includes('"to"'), "no from/to values leave the service");
  assert.deepEqual(out[1]!.fields, []);
  assert.equal(out[1]!.actor, null);
});

test("changedFields ignores bookkeeping and malformed input", () => {
  assert.deepEqual(history.changedFields({ updatedAt: 1, status: 1 }), ["status"]);
  assert.deepEqual(history.changedFields(null), []);
  assert.deepEqual(history.changedFields([1, 2]), []);
});

test("record tabs: core categories, then module tabs, then History", () => {
  assert.deepEqual(RECORD_TABS, [
    "overview",
    "job",
    "personal",
    "documents",
    "compensation",
    "performance",
    "tickets",
    "jml",
    "hiring",
    "history",
  ]);
});

test("record page hides each gated category when the select left it out", () => {
  const src = readFileSync("app/[locale]/(dashboard)/people/[id]/page.tsx", "utf8");
  for (const line of [
    'if (!detail.record.personal) hidden.push("personal")',
    // ADR-098: Documents unions every module's files; the tab hides only when
    // no source is open, and the ID-documents section still needs its own gate.
    'if (!documentsVisible) hidden.push("documents")',
    "Boolean(detail.record.idDocuments) ||",
    "{record.idDocuments ? <IdSection record={record} /> : null}",
    'if (basicSalary === undefined) hidden.push("compensation")',
    'if (!canSeeHistory) hidden.push("history")',
  ]) {
    assert.ok(src.includes(line), `missing: ${line}`);
  }
  // History is for whoever may edit this person.
  assert.match(src, /hiddenCoreTabs\(detail, basicSalary, canEditPerson, documentsVisible\)/);
});

test("placeholder employee IDs read as pending", () => {
  assert.equal(isPendingEmployeeId("PENDING-abc123"), true);
  assert.equal(isPendingEmployeeId("BOOTSTRAP-ADMIN"), true);
  assert.equal(isPendingEmployeeId("RH-0042"), false);
});

test("directory filters: org + reporting line accepted and bounded", () => {
  const ok = employeeListQuerySchema.safeParse({
    directorateId: "d1",
    teamId: "t1",
    managerId: "m1",
    roleTrack: "MANAGER",
  });
  assert.ok(ok.success);
  assert.ok(!employeeListQuerySchema.safeParse({ managerId: "x".repeat(65) }).success);
  const route = readFileSync("app/api/employees/route.ts", "utf8");
  assert.match(route, /teamId: filters\.teamId/);
  assert.match(route, /department: \{ directorateId: filters\.directorateId \}/);
  assert.match(route, /managerId: filters\.managerId/);
  // Status counts are one grouped query within the same visibility scope.
  assert.match(route, /groupBy\(\{ by: \["status"\], where: scoped/);
});

test("directory: salary column is off until the viewer turns it on", () => {
  const page = readFileSync("app/[locale]/(dashboard)/people/(list)/page.tsx", "utf8");
  assert.match(page, /useState\(false\)/);
  assert.match(page, /showCompensation: capabilities\.viewCompensation && showSalary/);
});
