import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Overnight item 2 (docs/blueprints/small-items.md): raise a ticket on an
 * employee's behalf, the answer-by setting, start joiner from the record, unit
 * heads. Pure-schema checks run everywhere; the service checks need
 * `--experimental-test-module-mocks` (npm test carries it).
 */

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

describe("raise a ticket on an employee's behalf", { skip: !canMock }, () => {
  let employee: Record<string, unknown> | null = null;
  let captured: { capture: Record<string, unknown>; ctx: Record<string, unknown> } | null = null;
  let result: Record<string, unknown> = {};
  let svc: typeof import("../../lib/hive/services/escalation-raise.ts");

  before(async () => {
    mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
      namedExports: {
        prisma: {
          employee: {
            findFirst: async ({ where }: { where: Record<string, unknown> }) => {
              assert.deepEqual(where.status, { not: "LEAVER" }, "leavers are never offered");
              return employee;
            },
            findMany: async () => [],
          },
        },
        auditedTransaction: async () => undefined,
      },
    });
    mockApi.module!(import.meta.resolve("../../lib/hive/services/escalation.ts"), {
      namedExports: {
        createEscalation: async (
          capture: Record<string, unknown>,
          ctx: Record<string, unknown>,
        ) => {
          captured = { capture, ctx };
          return result;
        },
      },
    });
    svc = await import("../../lib/hive/services/escalation-raise");
  });

  const SAMIRA = {
    id: "e-1",
    name: "Samira Al Hinai",
    email: "Samira@Rihal.om",
    entityId: "c-rihal",
    entity: { name: "Rihal" },
    departmentId: "d-hr",
    department: {
      name: "Human Resources",
      directorateId: "dir-ops",
      directorate: { name: "Operations" },
    },
  };

  test("the ticket is the employee's: record name/email, routed by their placement, source HR", async () => {
    employee = SAMIRA;
    result = {
      id: "esc-9",
      ticketNumber: 9,
      threadKey: "k",
      pairName: "Ops pair",
      matchedOn: "selector",
    };
    const out = await svc.raiseTicketForEmployee(
      { userId: "u-hr", name: "Huda" },
      { employeeId: "e-1", question: "When is my visa renewed?" },
    );
    assert.equal(out.ok, true);
    assert.deepEqual(captured!.capture, {
      employeeName: "Samira Al Hinai",
      employeeEmail: "samira@rihal.om",
      question: "When is my visa renewed?",
      directorate: "Operations",
      company: "Rihal",
    });
    assert.equal(captured!.ctx.source, "HR");
    assert.equal(captured!.ctx.companyId, "c-rihal");
    assert.equal(captured!.ctx.orgUnitId, "dir-ops");
    const raisedBy = captured!.ctx.raisedBy as { userId: string; employeeId: string; note: string };
    assert.equal(raisedBy.userId, "u-hr");
    assert.equal(raisedBy.employeeId, "e-1");
    assert.match(raisedBy.note, /Raised by HR \(Huda\) for Samira Al Hinai/);
  });

  test("unknown or departed employee → 404; no work email yet → 422; nothing raised", async () => {
    employee = null;
    captured = null;
    const missing = await svc.raiseTicketForEmployee(
      { userId: "u-hr", name: null },
      { employeeId: "nope", question: "Hello there" },
    );
    assert.deepEqual(missing, { ok: false, status: 404, error: "Employee not found." });
    employee = { ...SAMIRA, email: "pending-abc@pre-joiner.invalid" };
    const placeholder = await svc.raiseTicketForEmployee(
      { userId: "u-hr", name: null },
      { employeeId: "e-1", question: "Hello there" },
    );
    assert.equal(placeholder.ok, false);
    assert.equal(!placeholder.ok && placeholder.status, 422);
    assert.equal(captured, null);
  });

  test("a duplicate or rate-limited ask is refused with a sentence, not a second ticket", async () => {
    employee = SAMIRA;
    result = {
      id: "esc-1",
      ticketNumber: 1,
      threadKey: "k",
      pairName: "p",
      matchedOn: "existing",
      duplicate: true,
    };
    const dup = await svc.raiseTicketForEmployee(
      { userId: "u-hr", name: null },
      { employeeId: "e-1", question: "Hello there" },
    );
    assert.equal(!dup.ok && dup.status, 409);
    result = { error: "rate_limited" };
    const limited = await svc.raiseTicketForEmployee(
      { userId: "u-hr", name: null },
      { employeeId: "e-1", question: "Hello there" },
    );
    assert.equal(!limited.ok && limited.status, 429);
  });
});

test("raise route: Drafters only, and approval is untouched (no approve/send path)", () => {
  const route = readFileSync("app/api/hive/escalations/route.ts", "utf8");
  assert.match(route, /requireHivePermission\("draftEscalation"/);
  const service = readFileSync("lib/hive/services/escalation-raise.ts", "utf8");
  assert.doesNotMatch(service, /approvedById|status: "APPROVED"|sendEscalation/);
  const picker = readFileSync("app/api/hive/employees/route.ts", "utf8");
  assert.match(picker, /requireHivePermission\("draftEscalation"/);
});

test("answer-by target: 1–400 whole working hours, absent = unchanged", async () => {
  const v = await import("../../lib/validations/hive/ticket-settings");
  assert.equal(v.DEFAULT_RESPONSE_HOURS, 16);
  assert.equal(
    v.ticketSettingsSchema.parse({ ticketPrefix: "HR", statusLabels: {} }).responseHours,
    undefined,
  );
  assert.equal(
    v.ticketSettingsSchema.parse({ ticketPrefix: "HR", statusLabels: {}, responseHours: 24 })
      .responseHours,
    24,
  );
  for (const bad of [0, 401, 1.5, "16"]) {
    assert.equal(v.responseHoursSchema.safeParse(bad).success, false, String(bad));
  }
});

test("unit heads: kind + unit + nullable head; the route is the org-structure gate", async () => {
  const v = await import("../../lib/validations/org");
  assert.equal(
    v.setUnitHeadSchema.safeParse({ kind: "TEAM", unitId: "t1", headEmployeeId: null }).success,
    true,
  );
  assert.equal(
    v.setUnitHeadSchema.safeParse({ kind: "SQUAD", unitId: "t1", headEmployeeId: "e1" }).success,
    false,
  );
  const route = readFileSync("app/api/org/heads/route.ts", "utf8");
  assert.match(route, /capabilities\.orgManage\) return forbidden\(\)/);
  const service = readFileSync("lib/org/heads.ts", "utf8");
  assert.match(service, /a leaver cannot head a unit/);
});

test("unit heads replace HIVE's free-text leaders: tool reads core heads, nothing writes leaderName", () => {
  const tool = readFileSync("lib/hive/tools/orgchart.ts", "utf8");
  assert.match(tool, /head: HEAD/);
  assert.doesNotMatch(tool, /select: \{[^}]*leaderName/);
  for (const f of ["lib/hive/services/setup.ts", "prisma/seed-hive.ts"]) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /leaderName: (input|data|u)\./, f);
  }
  const migration = readFileSync(
    "prisma/migrations/20261029102306_small_heads_tickets_pms_roles/migration.sql",
    "utf8",
  );
  assert.match(migration, /HAVING COUNT\(DISTINCT e\."id"\) = 1/, "only unique name matches");
  assert.match(migration, /"head_employee_id" IS NULL/, "never overwrites a head");
});

test("start joiner case: PRE_JOINER without a live onboarding, Manage joiners in scope", () => {
  const page = readFileSync("app/[locale]/(dashboard)/people/[id]/page.tsx", "utf8");
  assert.match(
    page,
    /employee\.status === "PRE_JOINER" &&\s*!liveJoin &&\s*canFor\(actor, "jml\.manageJoiners", subject\)/,
  );
  const svc = readFileSync("lib/jml/join/open-join.ts", "utf8");
  assert.match(svc, /requireManage\(actor, subjectOf\(employee\), 404\)/);
});
