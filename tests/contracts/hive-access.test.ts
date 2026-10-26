import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PERMISSION_CODES, STARTER_ROLES } from "../../lib/rbac/catalogue";
import { canInScope, expandGrants, scopeCovers, type Grants } from "../../lib/rbac/grants";
import { TICKET_STARTER_ROLES } from "../../lib/hive/roles";
import { registerHivePairScopes } from "../../lib/hive/pair-scope";
import { assignmentBodySchema } from "../../lib/validations/rbac";

/**
 * HR tickets on HR Centre's role builder (docs/blueprints/hive.md US-H1; HIVE
 * ADR-073 semantics). HIVE's per-person grants (ALL / PAIR / OWN_PAIR) are now
 * assignments scoped GROUP / HR_PAIR / OWN_HR_PAIR; these pin that the bridge
 * answers exactly as HIVE's `permissions.ts` did.
 */

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

let grants: Grants = new Map();
let member: { pairId: string; deletedAt: Date | null; pair: { deletedAt: Date | null } } | null =
  null;
let memberReads = 0;

type Access = typeof import("../../lib/hive/services/permissions");
let access: Access;

before(async () => {
  registerHivePairScopes();
  if (!canMock) return;
  mockApi.module!(import.meta.resolve("../../lib/rbac/resolve.ts"), {
    namedExports: { loadGrants: async () => grants },
  });
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        hrTagMember: {
          findUnique: async () => {
            memberReads += 1;
            return member;
          },
        },
      },
    },
  });
  access = (await import(import.meta.resolve("../../lib/hive/services/permissions.ts"))) as Access;
});

const GROUP = { type: "GROUP", id: null };
const PAIR = (id: string) => ({ type: "HR_PAIR", id });
const OWN = { type: "OWN_HR_PAIR", id: null };

function hold(...a: Array<{ permissions: string[]; scope: { type: string; id: string | null } }>) {
  grants = expandGrants(a);
}

test("HR_PAIR covers the pair it names and no other", () => {
  assert.equal(scopeCovers(PAIR("p1"), { hrPairId: "p1" }), true);
  assert.equal(scopeCovers(PAIR("p1"), { hrPairId: "p2" }), false);
  assert.equal(scopeCovers(PAIR("p1"), {}), false, "no pair on the subject → nothing");
});

test("OWN_HR_PAIR covers only the actor's own pair; no member link covers nothing", () => {
  assert.equal(scopeCovers(OWN, { hrPairId: "p1", actorPairIds: ["p1"] }), true);
  assert.equal(scopeCovers(OWN, { hrPairId: "p2", actorPairIds: ["p1"] }), false);
  assert.equal(scopeCovers(OWN, { hrPairId: "p1", actorPairIds: [] }), false);
  assert.equal(scopeCovers(OWN, { hrPairId: "p1" }), false, "fail closed without actor pairs");
});

test("draft/approve honour pair scopes; the other ticket actions count only at Group", () => {
  const g = expandGrants([
    { permissions: ["tickets.draft", "tickets.see"], scope: PAIR("p1") },
    { permissions: ["tickets.approve"], scope: GROUP },
  ]);
  assert.equal(canInScope(g, "tickets.draft", { hrPairId: "p1" }), true);
  assert.equal(canInScope(g, "tickets.draft", { hrPairId: "p2" }), false);
  assert.equal(canInScope(g, "tickets.approve", { hrPairId: "anything" }), true);
  assert.equal(canInScope(g, "tickets.see", {}), false, "a pair-scoped see grants nothing");
});

test("an org-unit scope never covers a ticket pair", () => {
  const g = expandGrants([{ permissions: ["tickets.draft"], scope: { type: "COMPANY", id: "c" } }]);
  assert.equal(canInScope(g, "tickets.draft", { hrPairId: "p1", actorPairIds: ["p1"] }), false);
});

test(
  "getHivePermissions: any-pair semantics, and Draft does not imply Approve",
  { skip: !canMock },
  async () => {
    hold({ permissions: ["tickets.draft"], scope: OWN });
    const p = await access.getHivePermissions("u1");
    assert.equal(p.draftEscalation, true, "held for some pair");
    assert.equal(p.approve, false);
    assert.equal(p.seeTickets, false);
    assert.equal(access.roleLabelFor(p), "Drafter");
  },
);

test(
  "getHivePermissions: a COMPANY-scoped draft is not 'held for some pair'",
  { skip: !canMock },
  async () => {
    hold({ permissions: ["tickets.draft", "tickets.see"], scope: { type: "COMPANY", id: "c" } });
    const p = await access.getHivePermissions("u1");
    assert.equal(p.draftEscalation, false);
    assert.equal(p.seeTickets, false);
  },
);

test(
  "canOnPair: GROUP covers all pairs without reading the member link",
  { skip: !canMock },
  async () => {
    hold({ permissions: ["tickets.approve"], scope: GROUP });
    memberReads = 0;
    assert.equal(await access.canOnPair("u1", "approve", "p9"), true);
    assert.equal(memberReads, 0);
  },
);

test(
  "canOnPair: OWN_HR_PAIR follows the member link, fails closed without it",
  { skip: !canMock },
  async () => {
    hold({ permissions: ["tickets.draft"], scope: OWN });
    member = { pairId: "p1", deletedAt: null, pair: { deletedAt: null } };
    assert.equal(await access.canOnPair("u1", "draftEscalation", "p1"), true);
    assert.equal(await access.canOnPair("u1", "draftEscalation", "p2"), false);
    assert.equal(await access.canOnPair("u1", "approve", "p1"), false, "draft ≠ approve");
    member = null;
    assert.equal(await access.canOnPair("u1", "draftEscalation", "p1"), false);
    member = { pairId: "p1", deletedAt: new Date(), pair: { deletedAt: null } };
    assert.equal(await access.canOnPair("u1", "draftEscalation", "p1"), false, "deleted member");
    member = null;
  },
);

test("canOnPair: HR_PAIR cover covers the named pair only", { skip: !canMock }, async () => {
  hold({ permissions: ["tickets.approve"], scope: PAIR("p2") });
  assert.equal(await access.canOnPair("u1", "approve", "p2"), true);
  assert.equal(await access.canOnPair("u1", "approve", "p1"), false);
});

test("requireHivePermission refuses with 403, never hides", { skip: !canMock }, async () => {
  hold();
  const handler = access.requireHivePermission("seeTickets", async () => {
    throw new Error("must not run");
  });
  const res = await handler({} as never, {
    params: Promise.resolve({}),
    session: { user: { id: "u1" } } as never,
  });
  assert.equal(res.status, 403);
});

test("ticket starter roles use catalogue codes only; HR Super Admin is not widened", () => {
  for (const r of TICKET_STARTER_ROLES) {
    for (const p of r.permissions) assert.ok(PERMISSION_CODES.includes(p), `${r.key}: ${p}`);
  }
  const superAdmin = STARTER_ROLES.find((r) => r.key === "HR_SUPER_ADMIN")!;
  assert.ok(superAdmin.permissions.every((p) => !p.startsWith("tickets.")));
  // The pair-scoped actions are alone in their roles, so a scoped assignment of
  // them never strands a group-only action at a pair scope.
  for (const key of ["TICKETS_DRAFTER", "TICKETS_APPROVER"]) {
    const r = TICKET_STARTER_ROLES.find((x) => x.key === key)!;
    assert.equal(r.permissions.length, 1);
  }
});

test("assignment boundary: own HR pair names no unit; one HR pair names one", () => {
  const base = { userId: "u", roleId: "r" };
  assert.ok(assignmentBodySchema.safeParse({ ...base, scopeType: "OWN_HR_PAIR" }).success);
  assert.ok(
    !assignmentBodySchema.safeParse({ ...base, scopeType: "OWN_HR_PAIR", scopeId: "x" }).success,
  );
  assert.ok(!assignmentBodySchema.safeParse({ ...base, scopeType: "HR_PAIR" }).success);
  assert.ok(
    assignmentBodySchema.safeParse({ ...base, scopeType: "HR_PAIR", scopeId: "p1" }).success,
  );
});

test("guards: the last permanent group-wide ticket approver is protected", () => {
  const src = readFileSync("lib/rbac/guards.ts", "utf8");
  assert.match(src, /TICKET_APPROVER[^;]*"tickets\.approve"/);
  assert.match(src, /permanentOnly: true/, "cover assignments never count");
  const users = readFileSync("app/api/users/[id]/route.ts", "utf8");
  assert.match(
    users,
    /assertHrAccessAdminRemains\(\{ disabledUserId: id \}\)/,
    "user delete guarded",
  );
});

// --- Schema shape (HIVE hive-independent-structures, re-pointed at HR Centre) ---

const schema = readFileSync("prisma/schema.prisma", "utf8");
function model(name: string): string {
  const m = new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`).exec(schema);
  assert.ok(m, `model ${name}`);
  return m![1];
}

test("each coverage table owns its own label and aliases; org links are optional", () => {
  for (const name of ["HrTagCoverage", "RotationCoverage"]) {
    const body = model(name);
    assert.match(body, /\n\s+label\s+String\n/);
    assert.match(body, /\n\s+aliases\s+String\[\]/);
    assert.match(body, /\n\s+directorateId\s+String\?/);
    assert.match(body, /\n\s+departmentId\s+String\?/);
  }
  assert.match(model("HrTagCoverage"), /companyWide\s+Boolean/, "company-wide kept separate");
});

test("rotation config keeps the anchor and weekend as data; discount expiry is nullable", () => {
  const rc = model("RotationConfig");
  for (const f of ["anchorDate", "anchorType", "timezone", "weekendDays"])
    assert.match(rc, new RegExp(f));
  assert.match(model("DiscountPartner"), /validUntil\s+DateTime\?/);
});

test("tickets: employee link is nullable SetNull; legacy statuses are not ported", () => {
  const e = model("Escalation");
  assert.match(e, /employeeId\s+String\?/);
  assert.match(e, /"EscalationEmployee"[^\n]*onDelete: SetNull/);
  assert.match(e, /employeeName\s+String\n/);
  assert.match(e, /employeeEmail\s+String\n/);
  const statuses = /enum EscalationStatus \{([\s\S]*?)\}/.exec(schema)![1];
  assert.doesNotMatch(statuses, /\bNEW\b|\bDRAFTED\b/);
  assert.doesNotMatch(schema, /model (Company|OrgUnit) \{/, "HIVE's own org tables are not ported");
});

test("the migration installs pg_trgm and the trigram index", () => {
  const sql = readFileSync("prisma/migrations/20261027090000_hive_tickets/migration.sql", "utf8");
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS pg_trgm/);
  assert.match(sql, /hive_network_providers_name_trgm_idx[\s\S]*gin_trgm_ops/);
});

test("the seed holds no placeholder providers and no people", () => {
  const seed = readFileSync("prisma/seed-hive.ts", "utf8");
  assert.doesNotMatch(seed, /networkProvider\.create/);
  assert.doesNotMatch(seed, /user\.create/);
  assert.doesNotMatch(seed, /roleAssignment\.create/);
});
